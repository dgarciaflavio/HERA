const {
    iniciarBancoSidec,
    abrirBanco,
    dbRun,
    itemEstaSuspenso,
    extrairStatusVisual,
    extrairSituacaoItem
} = require('./sidec');

const API_ITEM_URL = 'https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial';

async function requisicaoJson(url, params = {}, timeoutMs = 30000) {
    const urlObj = new URL(url);

    Object.entries(params).forEach(([chave, valor]) => {
        if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
            urlObj.searchParams.set(chave, String(valor));
        }
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resposta = await fetch(urlObj.toString(), {
            method: 'GET',
            signal: controller.signal
        });

        if (!resposta.ok) {
            return null;
        }

        return await resposta.json();
    } catch (erro) {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

async function atualizarCatalogoSidecAtivo() {
    await iniciarBancoSidec();

    const db = abrirBanco();

    try {
        console.log('🌙 Atualização do catálogo SIDEC iniciada...');
        await dbRun(db, 'DELETE FROM catalogo_ativo');

        let pagina = 1;
        const tamanhoPagina = 500;
        let totalInseridos = 0;
        let totalSuspensosIgnorados = 0;

        while (true) {
            console.log(`📦 Baixando página ${pagina}...`);

            const dados = await requisicaoJson(API_ITEM_URL, {
                statusItem: 'true',
                pagina,
                tamanhoPagina
            });

            const resultados = dados?.resultado || [];

            if (!resultados.length) {
                break;
            }

            for (const item of resultados) {
                if (itemEstaSuspenso(item)) {
                    totalSuspensosIgnorados++;
                    continue;
                }

                await dbRun(db, `
                    INSERT OR REPLACE INTO catalogo_ativo (
                        codigo_item,
                        descricao_item,
                        codigo_pdm,
                        nome_pdm,
                        codigo_classe,
                        situacao_item,
                        status_visual,
                        atualizado_em
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    String(item.codigoItem || '').trim(),
                    String(item.descricaoItem || '').trim(),
                    String(item.codigoPdm || '').trim(),
                    String(item.nomePdm || '').trim(),
                    String(item.codigoClasse || '').trim(),
                    extrairSituacaoItem(item),
                    extrairStatusVisual(item)
                ]);

                totalInseridos++;
            }

            pagina++;
            await new Promise(resolve => setTimeout(resolve, 800));
        }

        console.log(
            `✅ Catálogo atualizado. ${totalInseridos} itens gravados. ` +
            `${totalSuspensosIgnorados} suspenso(s) ignorado(s).`
        );

        return {
            sucesso: true,
            totalInseridos,
            totalSuspensosIgnorados
        };
    } catch (erro) {
        console.error('❌ Erro ao atualizar catálogo SIDEC:', erro);
        return {
            sucesso: false,
            erro: erro.message || 'Erro desconhecido'
        };
    } finally {
        db.close();
    }
}

module.exports = {
    atualizarCatalogoSidecAtivo
};