const { abrirBanco, dbGet, salvarPregaoCache } = require('../services/pregoesCache');
const { buscarTodosItensDaCompra } = require('../services/api'); // Lembre de exportar buscarTodosItensDaCompra no api.js se não estiver

async function rotinaMadrugadaPregoes() {
    console.log('🔄 [CRON] Iniciando atualização de madrugada dos pregões não concluídos...');
    
    const db = abrirBanco();
    let pregoesPendentes = [];

    try {
        // Pega todos os pregões que ainda não atingiram 100% de finalização
        pregoesPendentes = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM pregoes_resumo WHERE concluido = 0', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    } finally {
        db.close();
    }

    if (pregoesPendentes.length === 0) {
        console.log('✅ [CRON] Nenhum pregão pendente de atualização.');
        return;
    }

    for (const pregao of pregoesPendentes) {
        try {
            console.log(`[CRON] Atualizando PE ${pregao.numero_limpo}/${pregao.ano}...`);
            await new Promise(res => setTimeout(res, 2000)); // Pausa de segurança

            const itensBrutos = await buscarTodosItensDaCompra(pregao.id_compra);
            
            let homologados = 0;
            let desertos = 0;
            let frustrados = 0;

            itensBrutos.forEach(item => {
                const sit = String(item.situacaoCompraItemNome || item.situacaoItem || '').toLowerCase();
                if (sit.includes('homologado')) homologados++;
                else if (sit.includes('deserto')) desertos++;
                else if (sit.includes('fracassado') || sit.includes('cancelado') || sit.includes('anulado')) frustrados++;
            });

            const totalEncerrados = homologados + desertos + frustrados;
            const concluido = (itensBrutos.length > 0 && totalEncerrados === itensBrutos.length);

            await salvarPregaoCache({
                idCompra: pregao.id_compra,
                numeroLimpo: pregao.numero_limpo,
                ano: pregao.ano,
                situacaoGeral: pregao.situacao_geral,
                totalItens: itensBrutos.length,
                homologados,
                desertos,
                frustrados,
                concluido
            });

            if (concluido) {
                console.log(`🌟 [CRON] PE ${pregao.numero_limpo}/${pregao.ano} atingiu 100% e foi concluído!`);
            }

        } catch (erro) {
            console.error(`❌ [CRON] Erro ao atualizar PE ${pregao.numero_limpo}:`, erro.message);
        }
    }

    console.log('✅ [CRON] Atualização de madrugada finalizada.');
}

module.exports = { rotinaMadrugadaPregoes };