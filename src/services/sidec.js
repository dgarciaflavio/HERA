const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { catalogoSidecPath } = require('../config/paths');

const API_ITEM_URL = 'https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial';
const API_PDM_URL = 'https://dadosabertos.compras.gov.br/modulo-material/3_consultarPdmMaterial';

const caminhoBanco = catalogoSidecPath;
const caminhoBloqueados = path.join(process.cwd(), 'data', 'sidec_bloqueados.json');

function garantirDiretorioDoBanco() {
    const diretorio = path.dirname(caminhoBanco);

    if (!fs.existsSync(diretorio)) {
        fs.mkdirSync(diretorio, { recursive: true });
    }
}

function garantirArquivoBloqueados() {
    const diretorio = path.dirname(caminhoBloqueados);

    if (!fs.existsSync(diretorio)) {
        fs.mkdirSync(diretorio, { recursive: true });
    }

    if (!fs.existsSync(caminhoBloqueados)) {
        fs.writeFileSync(
            caminhoBloqueados,
            JSON.stringify({ codigosBloqueados: [] }, null, 2),
            'utf-8'
        );
    }
}

function abrirBanco() {
    garantirDiretorioDoBanco();
    return new sqlite3.Database(caminhoBanco);
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (erro, row) => {
            if (erro) {
                reject(erro);
                return;
            }
            resolve(row);
        });
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (erro, rows) => {
            if (erro) {
                reject(erro);
                return;
            }
            resolve(rows || []);
        });
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (erro) {
            if (erro) {
                reject(erro);
                return;
            }
            resolve(this);
        });
    });
}

async function iniciarBancoSidec() {
    const db = abrirBanco();

    try {
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS cache_sidec (
                codigo TEXT PRIMARY KEY,
                status TEXT,
                pdm_original TEXT,
                codigo_substituto TEXT,
                descricao_substituta TEXT,
                pdm_substituto TEXT,
                descricao_original TEXT
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS cache_pdm (
                codigo_pdm TEXT PRIMARY KEY,
                status_pdm TEXT
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS cache_item_detalhe (
                codigo_item TEXT PRIMARY KEY,
                status_item TEXT,
                situacao_item TEXT,
                status_visual TEXT,
                codigo_pdm TEXT,
                nome_pdm TEXT,
                descricao_item TEXT,
                codigo_classe TEXT,
                raw_json TEXT,
                atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS catalogo_ativo (
                codigo_item TEXT PRIMARY KEY,
                descricao_item TEXT,
                codigo_pdm TEXT,
                nome_pdm TEXT,
                codigo_classe TEXT,
                situacao_item TEXT,
                status_visual TEXT,
                atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await dbRun(db, `
            CREATE INDEX IF NOT EXISTS idx_catalogo_ativo_pdm
            ON catalogo_ativo (codigo_pdm)
        `);

        await dbRun(db, `
            CREATE INDEX IF NOT EXISTS idx_catalogo_ativo_classe
            ON catalogo_ativo (codigo_classe)
        `);
    } finally {
        db.close();
    }
}

function limparCodigo(codigo) {
    if (codigo === null || codigo === undefined) {
        return '';
    }

    let codigoLimpo = String(codigo).trim().toUpperCase().replace('BR', '');

    if (!codigoLimpo || codigoLimpo === 'NAN' || codigoLimpo === 'NONE') {
        return '';
    }

    const numero = Number(codigoLimpo);

    if (!Number.isNaN(numero)) {
        return String(parseInt(numero, 10));
    }

    return codigoLimpo;
}

function removerAcentos(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizarTextoComparacao(valor) {
    return removerAcentos(String(valor || ''))
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function interpretarBoolean(valor) {
    return ['true', '1'].includes(String(valor || '').toLowerCase());
}

function carregarBloqueadosManuais() {
    garantirArquivoBloqueados();

    try {
        const conteudo = fs.readFileSync(caminhoBloqueados, 'utf-8');
        const json = JSON.parse(conteudo);

        if (!Array.isArray(json.codigosBloqueados)) {
            return [];
        }

        return json.codigosBloqueados.map(item => ({
            codigo: limparCodigo(item.codigo),
            motivo: String(item.motivo || 'Bloqueado manualmente').trim()
        }));
    } catch (erro) {
        console.error('Erro ao ler sidec_bloqueados.json:', erro);
        return [];
    }
}

function salvarBloqueadosManuais(lista) {
    garantirArquivoBloqueados();

    const normalizada = (lista || [])
        .map(item => ({
            codigo: limparCodigo(item.codigo),
            motivo: String(item.motivo || 'Bloqueado manualmente').trim()
        }))
        .filter(item => item.codigo)
        .sort((a, b) => a.codigo.localeCompare(b.codigo));

    fs.writeFileSync(
        caminhoBloqueados,
        JSON.stringify({ codigosBloqueados: normalizada }, null, 2),
        'utf-8'
    );
}

function obterBloqueioManual(codigo) {
    const codigoLimpo = limparCodigo(codigo);
    const lista = carregarBloqueadosManuais();
    return lista.find(item => item.codigo === codigoLimpo) || null;
}

function listarBloqueiosSidec() {
    return carregarBloqueadosManuais();
}

function bloquearCodigoSidec(codigo, motivo = 'Bloqueado manualmente') {
    const codigoLimpo = limparCodigo(codigo);

    if (!codigoLimpo) {
        return {
            sucesso: false,
            mensagem: '❌ Código SIDEC inválido.'
        };
    }

    const lista = carregarBloqueadosManuais();
    const existente = lista.find(item => item.codigo === codigoLimpo);

    if (existente) {
        existente.motivo = String(motivo || 'Bloqueado manualmente').trim();
    } else {
        lista.push({
            codigo: codigoLimpo,
            motivo: String(motivo || 'Bloqueado manualmente').trim()
        });
    }

    salvarBloqueadosManuais(lista);

    return {
        sucesso: true,
        codigo: codigoLimpo,
        motivo: String(motivo || 'Bloqueado manualmente').trim(),
        mensagem: `✅ Código SIDEC ${codigoLimpo} bloqueado com sucesso. Motivo: ${motivo}`
    };
}

function desbloquearCodigoSidec(codigo) {
    const codigoLimpo = limparCodigo(codigo);

    if (!codigoLimpo) {
        return {
            sucesso: false,
            mensagem: '❌ Código SIDEC inválido.'
        };
    }

    const lista = carregarBloqueadosManuais();
    const antes = lista.length;
    const novaLista = lista.filter(item => item.codigo !== codigoLimpo);

    salvarBloqueadosManuais(novaLista);

    if (novaLista.length === antes) {
        return {
            sucesso: false,
            mensagem: `⚠️ O código SIDEC ${codigoLimpo} não estava bloqueado.`
        };
    }

    return {
        sucesso: true,
        codigo: codigoLimpo,
        mensagem: `✅ Código SIDEC ${codigoLimpo} desbloqueado com sucesso.`
    };
}

async function requisicaoJson(url, params = {}, timeoutMs = 15000) {
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

function extrairSituacaoItem(item = {}, codigo = '') {
    const bloqueioManual = obterBloqueioManual(codigo || item.codigoItem || item.codigo_item);

    if (bloqueioManual) {
        return `Não utilizável - ${bloqueioManual.motivo}`;
    }

    return String(
        item.situacaoItem ||
        item.situacao ||
        item.statusVisual ||
        item.statusCatalogo ||
        item.acao ||
        item.status ||
        ''
    ).trim();
}

function itemEstaSuspenso(item = {}, codigo = '') {
    const bloqueioManual = obterBloqueioManual(codigo || item.codigoItem || item.codigo_item);
    if (bloqueioManual) {
        return true;
    }

    const camposSuspeitos = [
        item.situacaoItem,
        item.situacao,
        item.statusVisual,
        item.statusCatalogo,
        item.acao,
        item.status,
        item.descricaoSituacao,
        item.indicadorSuspensao,
        item.suspenso
    ];

    const textoUnificado = camposSuspeitos
        .map(v => normalizarTextoComparacao(v))
        .filter(Boolean)
        .join(' | ');

    if (!textoUnificado) {
        return false;
    }

    return (
        textoUnificado.includes('suspenso') ||
        textoUnificado.includes('suspensa') ||
        textoUnificado.includes('suspensao') ||
        textoUnificado.includes('suspensão')
    );
}

function extrairStatusVisual(item = {}, codigo = '') {
    const bloqueioManual = obterBloqueioManual(codigo || item.codigoItem || item.codigo_item);

    if (bloqueioManual) {
        return 'Não utilizável';
    }

    if (itemEstaSuspenso(item, codigo)) {
        return 'Não utilizável';
    }

    if (interpretarBoolean(item.statusItem)) {
        return 'Utilizável';
    }

    return 'Não utilizável';
}

async function isPdmActive(codigoPdm) {
    if (!codigoPdm) {
        return false;
    }

    const codigoPdmPrincipal = String(codigoPdm).split('-')[0].trim();
    const db = abrirBanco();

    try {
        const row = await dbGet(
            db,
            'SELECT status_pdm FROM cache_pdm WHERE codigo_pdm = ?',
            [codigoPdmPrincipal]
        );

        if (row) {
            return interpretarBoolean(row.status_pdm);
        }
    } catch (erro) {
    } finally {
        db.close();
    }

    let status = false;

    try {
        const dados = await requisicaoJson(API_PDM_URL, { codigoPdm: codigoPdmPrincipal }, 10000);

        if (dados && Array.isArray(dados.resultado) && dados.resultado.length > 0) {
            status = interpretarBoolean(dados.resultado[0].statusPdm);
        }
    } catch (erro) {
        status = false;
    }

    const dbSalvar = abrirBanco();
    try {
        await dbRun(
            dbSalvar,
            'INSERT OR REPLACE INTO cache_pdm (codigo_pdm, status_pdm) VALUES (?, ?)',
            [codigoPdmPrincipal, String(status)]
        );
    } catch (erro) {
    } finally {
        dbSalvar.close();
    }

    return status;
}

async function salvarCacheItemDetalhe(item) {
    if (!item || !item.codigoItem) {
        return;
    }

    const codigo = String(item.codigoItem || '').trim();
    const db = abrirBanco();

    try {
        await dbRun(db, `
            INSERT OR REPLACE INTO cache_item_detalhe (
                codigo_item,
                status_item,
                situacao_item,
                status_visual,
                codigo_pdm,
                nome_pdm,
                descricao_item,
                codigo_classe,
                raw_json,
                atualizado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
            codigo,
            String(item.statusItem || ''),
            extrairSituacaoItem(item, codigo),
            extrairStatusVisual(item, codigo),
            String(item.codigoPdm || '').trim(),
            String(item.nomePdm || '').trim(),
            String(item.descricaoItem || '').trim(),
            String(item.codigoClasse || '').trim(),
            JSON.stringify(item)
        ]);
    } catch (erro) {
    } finally {
        db.close();
    }
}

async function consultarItemOriginal(codigo) {
    const codigoLimpo = limparCodigo(codigo);

    if (!codigoLimpo) {
        return null;
    }

    const db = abrirBanco();

    try {
        const row = await dbGet(
            db,
            'SELECT raw_json FROM cache_item_detalhe WHERE codigo_item = ?',
            [codigoLimpo]
        );

        if (row && row.raw_json) {
            try {
                return JSON.parse(row.raw_json);
            } catch (erro) {
            }
        }
    } catch (erro) {
    } finally {
        db.close();
    }

    const dados = await requisicaoJson(API_ITEM_URL, { codigoItem: codigoLimpo }, 10000);

    if (!dados || !Array.isArray(dados.resultado) || dados.resultado.length === 0) {
        return null;
    }

    const item = dados.resultado[0];
    await salvarCacheItemDetalhe(item);
    return item;
}

async function buscarAtivosAPI(params) {
    const dados = await requisicaoJson(API_ITEM_URL, params, 15000);

    if (!dados || !Array.isArray(dados.resultado)) {
        return [];
    }

    return dados.resultado.filter(item => {
        const codigo = String(item.codigoItem || '').trim();
        return interpretarBoolean(item.statusItem) && !itemEstaSuspenso(item, codigo);
    });
}

async function buscarAtivosPorPdmLocal(codigoPdm) {
    const db = abrirBanco();

    try {
        const rows = await dbAll(db, `
            SELECT codigo_item, descricao_item, codigo_pdm, nome_pdm, codigo_classe, status_visual, situacao_item
            FROM catalogo_ativo
            WHERE codigo_pdm = ?
            LIMIT 300
        `, [String(codigoPdm || '').trim()]);

        return rows
            .filter(row => normalizarTextoComparacao(row.status_visual) !== 'nao utilizavel')
            .map(row => ({
                codigoItem: row.codigo_item,
                descricaoItem: row.descricao_item,
                codigoPdm: row.codigo_pdm,
                nomePdm: row.nome_pdm,
                codigoClasse: row.codigo_classe,
                statusItem: true,
                situacaoItem: row.situacao_item,
                statusVisual: row.status_visual
            }));
    } catch (erro) {
        return [];
    } finally {
        db.close();
    }
}

async function buscarAtivosPorClasseLocal(codigoClasse) {
    const db = abrirBanco();

    try {
        const rows = await dbAll(db, `
            SELECT codigo_item, descricao_item, codigo_pdm, nome_pdm, codigo_classe, status_visual, situacao_item
            FROM catalogo_ativo
            WHERE codigo_classe = ?
            LIMIT 500
        `, [String(codigoClasse || '').trim()]);

        return rows
            .filter(row => normalizarTextoComparacao(row.status_visual) !== 'nao utilizavel')
            .map(row => ({
                codigoItem: row.codigo_item,
                descricaoItem: row.descricao_item,
                codigoPdm: row.codigo_pdm,
                nomePdm: row.nome_pdm,
                codigoClasse: row.codigo_classe,
                statusItem: true,
                situacaoItem: row.situacao_item,
                statusVisual: row.status_visual
            }));
    } catch (erro) {
        return [];
    } finally {
        db.close();
    }
}

async function buscarAtivosPorDescricaoLocal(descricao) {
    const palavras = removerAcentos(String(descricao || ''))
        .toLowerCase()
        .split(/\s+/)
        .map(p => p.trim())
        .filter(p => p.length > 3)
        .slice(0, 2);

    if (palavras.length < 2) {
        return [];
    }

    const db = abrirBanco();

    try {
        const rows = await dbAll(db, `
            SELECT codigo_item, descricao_item, codigo_pdm, nome_pdm, codigo_classe, status_visual, situacao_item
            FROM catalogo_ativo
            LIMIT 5000
        `);

        const encontrados = rows.filter(row => {
            if (normalizarTextoComparacao(row.status_visual) === 'nao utilizavel') {
                return false;
            }

            const texto = removerAcentos(String(row.descricao_item || '')).toLowerCase();
            return palavras.every(p => texto.includes(p));
        }).slice(0, 500);

        return encontrados.map(row => ({
            codigoItem: row.codigo_item,
            descricaoItem: row.descricao_item,
            codigoPdm: row.codigo_pdm,
            nomePdm: row.nome_pdm,
            codigoClasse: row.codigo_classe,
            statusItem: true,
            situacaoItem: row.situacao_item,
            statusVisual: row.status_visual
        }));
    } catch (erro) {
        return [];
    } finally {
        db.close();
    }
}

function calcularSimilaridadeTokenSort(a, b) {
    const normalizar = texto =>
        removerAcentos(String(texto || ''))
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(Boolean)
            .sort()
            .join(' ');

    const textoA = normalizar(a);
    const textoB = normalizar(b);

    if (!textoA || !textoB) {
        return 0;
    }

    if (textoA === textoB) {
        return 100;
    }

    const palavrasA = textoA.split(' ');
    const palavrasB = textoB.split(' ');

    let interseccao = 0;
    const usadas = new Array(palavrasB.length).fill(false);

    for (const palavraA of palavrasA) {
        for (let i = 0; i < palavrasB.length; i++) {
            if (!usadas[i] && palavraA === palavrasB[i]) {
                usadas[i] = true;
                interseccao++;
                break;
            }
        }
    }

    const total = Math.max(palavrasA.length, palavrasB.length);

    if (total === 0) {
        return 0;
    }

    return Math.round((interseccao / total) * 100);
}

async function encontrarSubstituto(descricaoOriginal, listaAtivos, pdmBloqueado = null) {
    if (!Array.isArray(listaAtivos) || listaAtivos.length === 0) {
        return {
            codigoSubstituto: '-',
            descricaoSubstituta: '-',
            pdmSubstituto: '-'
        };
    }

    const candidatosOrdenados = listaAtivos
        .filter(item => !itemEstaSuspenso(item, item.codigoItem))
        .map(item => ({
            item,
            score: calcularSimilaridadeTokenSort(descricaoOriginal, item.descricaoItem || '')
        }))
        .sort((a, b) => b.score - a.score);

    for (const candidato of candidatosOrdenados) {
        if (candidato.score < 60) {
            continue;
        }

        const item = candidato.item;
        const codigoPdmCandidato = String(item.codigoPdm || '').trim();

        if (pdmBloqueado && codigoPdmCandidato === String(pdmBloqueado).trim()) {
            continue;
        }

        if (itemEstaSuspenso(item, item.codigoItem)) {
            continue;
        }

        const pdmAtivo = await isPdmActive(codigoPdmCandidato);

        if (pdmAtivo) {
            return {
                codigoSubstituto: item.codigoItem || '-',
                descricaoSubstituta: item.descricaoItem || '-',
                pdmSubstituto: `${codigoPdmCandidato} - ${item.nomePdm || ''}`
            };
        }
    }

    return {
        codigoSubstituto: '-',
        descricaoSubstituta: 'Nenhum item com similaridade segura encontrado',
        pdmSubstituto: '-'
    };
}

async function obterCandidatosSubstituicao({ itemOriginal, descricaoOriginal, codigoPdmOriginal, statusPdmOriginal }) {
    let candidatos = [];
    let pdmBloqueado = null;

    if (!statusPdmOriginal) {
        pdmBloqueado = codigoPdmOriginal;
    }

    if (statusPdmOriginal) {
        candidatos = await buscarAtivosPorPdmLocal(codigoPdmOriginal);

        if (!candidatos.length) {
            candidatos = await buscarAtivosAPI({
                codigoPdm: codigoPdmOriginal,
                statusItem: 'true',
                tamanhoPagina: 100
            });
        }
    }

    if ((!candidatos || candidatos.length === 0) && descricaoOriginal) {
        candidatos = await buscarAtivosPorDescricaoLocal(descricaoOriginal);

        if (!candidatos.length) {
            const palavras = removerAcentos(String(descricaoOriginal || ''))
                .split(/\s+/)
                .map(p => p.trim())
                .filter(p => p.length > 3);

            if (palavras.length >= 2) {
                candidatos = await buscarAtivosAPI({
                    descricaoItem: `${palavras[0]} ${palavras[1]}`,
                    statusItem: 'true',
                    tamanhoPagina: 500
                });
            }
        }
    }

    if ((!candidatos || candidatos.length === 0) && itemOriginal.codigoClasse) {
        candidatos = await buscarAtivosPorClasseLocal(itemOriginal.codigoClasse);

        if (!candidatos.length) {
            candidatos = await buscarAtivosAPI({
                codigoClasse: itemOriginal.codigoClasse,
                statusItem: 'true',
                tamanhoPagina: 500
            });
        }
    }

    return { candidatos, pdmBloqueado };
}

async function consultarCodigoSidecMaterial(codigoInformado) {
    await iniciarBancoSidec();

    const codigoLimpo = limparCodigo(codigoInformado);

    if (!codigoLimpo) {
        return {
            sucesso: false,
            mensagem: '❌ Código SIDEC inválido.'
        };
    }

    const itemOriginal = await consultarItemOriginal(codigoLimpo);

    if (!itemOriginal) {
        return {
            sucesso: false,
            mensagem: `⚠️ Não encontrei o código SIDEC *${codigoLimpo}* na base de materiais.`
        };
    }

    const descricaoOriginal = String(itemOriginal.descricaoItem || '').trim();
    const codigoPdmOriginal = String(itemOriginal.codigoPdm || '').trim();
    const nomePdmOriginal = String(itemOriginal.nomePdm || '').trim();

    const bloqueioManual = obterBloqueioManual(codigoLimpo);
    const suspenso = itemEstaSuspenso(itemOriginal, codigoLimpo);
    const statusItemBoolean = interpretarBoolean(itemOriginal.statusItem);
    const utilizavel = statusItemBoolean && !suspenso;
    const statusPdmOriginal = await isPdmActive(codigoPdmOriginal);
    const statusVisual = extrairStatusVisual(itemOriginal, codigoLimpo);
    const situacaoItem = extrairSituacaoItem(itemOriginal, codigoLimpo);

    const resultado = {
        sucesso: true,
        codigoOriginal: codigoLimpo,
        descricaoOriginal,
        statusItemOriginal: utilizavel ? 'Utilizável' : 'Não utilizável',
        codigoPdmOriginal,
        nomePdmOriginal,
        statusPdmOriginal: statusPdmOriginal ? 'Ativo' : 'Inativo',
        situacaoItem: situacaoItem || statusVisual || '-',
        codigoSubstituto: '-',
        descricaoSubstituta: '-',
        pdmSubstituto: '-',
        mensagem: ''
    };

    if (utilizavel && statusPdmOriginal) {
        resultado.mensagem =
            `🔎 *Consulta SIDEC / CATMAT*\n\n` +
            `*Código:* ${resultado.codigoOriginal}\n` +
            `*Descrição:* ${resultado.descricaoOriginal || 'N/A'}\n` +
            `*Status do item:* ${resultado.statusItemOriginal}\n` +
            `*Situação do catálogo:* ${resultado.situacaoItem}\n` +
            `*PDM original:* ${resultado.codigoPdmOriginal || '-'} - ${resultado.nomePdmOriginal || ''}\n` +
            `*Status do PDM:* ${resultado.statusPdmOriginal}\n\n` +
            `✅ O item está utilizável e o PDM está ativo.`;

        return resultado;
    }

    const { candidatos, pdmBloqueado } = await obterCandidatosSubstituicao({
        itemOriginal,
        descricaoOriginal,
        codigoPdmOriginal,
        statusPdmOriginal
    });

    const substituto = await encontrarSubstituto(descricaoOriginal, candidatos, pdmBloqueado);

    resultado.codigoSubstituto = substituto.codigoSubstituto;
    resultado.descricaoSubstituta = substituto.descricaoSubstituta;
    resultado.pdmSubstituto = substituto.pdmSubstituto;

    let observacao = '';
    if (bloqueioManual) {
        observacao = `\n*Observação:* item marcado manualmente como não utilizável (${bloqueioManual.motivo}).\n`;
    }

    resultado.mensagem =
        `🔎 *Consulta SIDEC / CATMAT*\n\n` +
        `*Código:* ${resultado.codigoOriginal}\n` +
        `*Descrição:* ${resultado.descricaoOriginal || 'N/A'}\n` +
        `*Status do item:* ${resultado.statusItemOriginal}\n` +
        `*Situação do catálogo:* ${resultado.situacaoItem}\n` +
        `*PDM original:* ${resultado.codigoPdmOriginal || '-'} - ${resultado.nomePdmOriginal || ''}\n` +
        `*Status do PDM:* ${resultado.statusPdmOriginal}\n` +
        observacao +
        `\n🔄 *Sugestão de substituição:*\n` +
        `*Novo SIDEC:* ${resultado.codigoSubstituto}\n` +
        `*Nova descrição:* ${resultado.descricaoSubstituta}\n` +
        `*Novo PDM:* ${resultado.pdmSubstituto}`;

    return resultado;
}

async function analisarCodigoSidecParaPlanilha(codigoInformado, descricaoDaPlanilha = '') {
    await iniciarBancoSidec();

    const codigoLimpo = limparCodigo(codigoInformado);

    if (!codigoLimpo) {
        return null;
    }

    const itemOriginal = await consultarItemOriginal(codigoLimpo);

    const resultadoBase = {
        Cod_Original: codigoInformado,
        Desc_INCA: String(descricaoDaPlanilha || '').trim(),
        Status: 'Não Encontrado',
        PDM_Orig: '-',
        Novo_Cod: '-',
        Novo_PDM: '-',
        Desc_Nova: '-'
    };

    if (!itemOriginal) {
        return resultadoBase;
    }

    const descricaoOriginalApi = String(itemOriginal.descricaoItem || '').trim();
    const descricaoReferencia = String(descricaoDaPlanilha || '').trim() || descricaoOriginalApi;

    const codigoPdmOriginal = String(itemOriginal.codigoPdm || '').trim();
    const nomePdmOriginal = String(itemOriginal.nomePdm || '').trim();

    const suspenso = itemEstaSuspenso(itemOriginal, codigoLimpo);
    const statusItemBoolean = interpretarBoolean(itemOriginal.statusItem);
    const utilizavel = statusItemBoolean && !suspenso;
    const statusPdmOriginal = await isPdmActive(codigoPdmOriginal);

    resultadoBase.PDM_Orig = `${codigoPdmOriginal} - ${nomePdmOriginal}`;

    if (utilizavel && statusPdmOriginal) {
        resultadoBase.Status = 'Utilizável';
        return resultadoBase;
    }

    resultadoBase.Status = 'Não utilizável';

    const { candidatos, pdmBloqueado } = await obterCandidatosSubstituicao({
        itemOriginal,
        descricaoOriginal: descricaoReferencia,
        codigoPdmOriginal,
        statusPdmOriginal
    });

    const substituto = await encontrarSubstituto(descricaoReferencia, candidatos, pdmBloqueado);

    resultadoBase.Novo_Cod = substituto.codigoSubstituto;
    resultadoBase.Novo_PDM = substituto.pdmSubstituto;
    resultadoBase.Desc_Nova = substituto.descricaoSubstituta;

    return resultadoBase;
}

function extrairCodigoSidecDaMensagem(texto) {
    const textoMensagem = String(texto || '').trim();

    const match = textoMensagem.match(/\b(?:sidec|catmat|consultar sidec|consultar catmat)\s+([A-Z0-9.-]+)\b/i);

    if (match && match[1]) {
        return limparCodigo(match[1]);
    }

    return null;
}

async function debugCodigoSidecMaterial(codigoInformado) {
    await iniciarBancoSidec();

    const codigoLimpo = limparCodigo(codigoInformado);

    if (!codigoLimpo) {
        return '❌ Código SIDEC inválido para debug.';
    }

    const itemOriginal = await consultarItemOriginal(codigoLimpo);

    if (!itemOriginal) {
        return `⚠️ Debug SIDEC: não encontrei o código ${codigoLimpo}.`;
    }

    const bloqueioManual = obterBloqueioManual(codigoLimpo);
    const codigoPdmOriginal = String(itemOriginal.codigoPdm || '').trim();
    const statusPdmOriginal = await isPdmActive(codigoPdmOriginal);

    const camposSuspeitos = {
        statusItem: itemOriginal.statusItem,
        situacaoItem: itemOriginal.situacaoItem,
        situacao: itemOriginal.situacao,
        statusVisual: itemOriginal.statusVisual,
        statusCatalogo: itemOriginal.statusCatalogo,
        acao: itemOriginal.acao,
        status: itemOriginal.status,
        descricaoSituacao: itemOriginal.descricaoSituacao,
        indicadorSuspensao: itemOriginal.indicadorSuspensao,
        suspenso: itemOriginal.suspenso
    };

    const chaves = Object.keys(itemOriginal).sort();
    const primeirasChaves = chaves.slice(0, 40);

    let texto = `🛠️ *DEBUG SIDEC / CATMAT*\n\n`;
    texto += `*Código:* ${codigoLimpo}\n`;
    texto += `*Descrição:* ${String(itemOriginal.descricaoItem || 'N/A').trim()}\n`;
    texto += `*PDM:* ${codigoPdmOriginal || '-'} - ${String(itemOriginal.nomePdm || '').trim()}\n`;
    texto += `*statusPdm:* ${statusPdmOriginal ? 'Ativo' : 'Inativo'}\n`;
    texto += `*bloqueioManual:* ${bloqueioManual ? `SIM (${bloqueioManual.motivo})` : 'NÃO'}\n`;
    texto += `*itemEstaSuspenso():* ${itemEstaSuspenso(itemOriginal, codigoLimpo) ? 'SIM' : 'NÃO'}\n`;
    texto += `*statusVisual calculado:* ${extrairStatusVisual(itemOriginal, codigoLimpo)}\n`;
    texto += `*situacaoItem extraída:* ${extrairSituacaoItem(itemOriginal, codigoLimpo) || '-'}\n\n`;

    texto += `*Campos suspeitos de suspensão:*\n`;
    Object.entries(camposSuspeitos).forEach(([chave, valor]) => {
        texto += `- ${chave}: ${String(valor ?? '') || '(vazio)'}\n`;
    });

    texto += `\n*Primeiras chaves do JSON bruto:*\n`;
    primeirasChaves.forEach(chave => {
        const valor = itemOriginal[chave];
        texto += `- ${chave}: ${typeof valor === 'object' ? '[objeto]' : String(valor ?? '')}\n`;
    });

    if (chaves.length > primeirasChaves.length) {
        texto += `- ... mais ${chaves.length - primeirasChaves.length} chave(s)\n`;
    }

    return texto.trim();
}

module.exports = {
    iniciarBancoSidec,
    consultarCodigoSidecMaterial,
    extrairCodigoSidecDaMensagem,
    analisarCodigoSidecParaPlanilha,
    limparCodigo,
    isPdmActive,
    abrirBanco,
    dbRun,
    itemEstaSuspenso,
    extrairStatusVisual,
    extrairSituacaoItem,
    debugCodigoSidecMaterial,
    bloquearCodigoSidec,
    desbloquearCodigoSidec,
    listarBloqueiosSidec
};