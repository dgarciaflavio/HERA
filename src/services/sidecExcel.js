const fs = require('fs');
const path = require('path');
const os = require('os');
const xlsx = require('xlsx');
const { analisarCodigoSidecParaPlanilha, limparCodigo, iniciarBancoSidec } = require('./sidec');

function garantirDiretorio(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function normalizarTexto(valor) {
    return String(valor || '').trim();
}

function encontrarLinhaCabecalho(sheetAoA) {
    for (let i = 0; i < sheetAoA.length; i++) {
        const linha = (sheetAoA[i] || []).map(col => String(col || '').trim());
        if (linha.includes('Descrição do Material')) {
            return i;
        }
    }
    return 0;
}

function criarLimitadorConcorrencia(maximo = 3) {
    let executando = 0;
    const fila = [];

    const proximo = () => {
        if (executando >= maximo || fila.length === 0) {
            return;
        }

        executando++;
        const { fn, resolve, reject } = fila.shift();

        Promise.resolve()
            .then(fn)
            .then(resolve)
            .catch(reject)
            .finally(() => {
                executando--;
                proximo();
            });
    };

    return fn => new Promise((resolve, reject) => {
        fila.push({ fn, resolve, reject });
        proximo();
    });
}

async function processarArquivoExcelSidec(caminhoEntrada, opcoes = {}) {
    const concorrencia = Number(opcoes.concorrencia || 3);
    const onProgress = typeof opcoes.onProgress === 'function' ? opcoes.onProgress : null;

    await iniciarBancoSidec();

    const workbook = xlsx.readFile(caminhoEntrada);
    const primeiraAba = workbook.Sheets[workbook.SheetNames[0]];
    const sheetAoA = xlsx.utils.sheet_to_json(primeiraAba, { header: 1, defval: '' });

    const headerRow = encontrarLinhaCabecalho(sheetAoA);
    const dados = xlsx.utils.sheet_to_json(primeiraAba, {
        defval: '',
        range: headerRow
    });

    const linhasValidas = dados
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => limparCodigo(row['Código Sidec'] || ''));

    const total = linhasValidas.length;
    let processadas = 0;

    if (onProgress) {
        onProgress({ total, processadas, etapa: 'iniciando' });
    }

    const limitar = criarLimitadorConcorrencia(concorrencia);

    const resultados = await Promise.all(
        linhasValidas.map(({ row, index }) =>
            limitar(async () => {
                const resultado = await analisarCodigoSidecParaPlanilha(
                    row['Código Sidec'],
                    row['Descrição do Material']
                );

                processadas++;

                if (onProgress) {
                    onProgress({ total, processadas, etapa: 'processando' });
                }

                return {
                    Item: row['Item'] || index + 1,
                    Desc_INCA: normalizarTexto(row['Descrição do Material']),
                    Cod_Original: row['Código Sidec'],
                    Status: resultado?.Status || 'Não Encontrado',
                    PDM_Orig: resultado?.PDM_Orig || '-',
                    Novo_Cod: resultado?.Novo_Cod || '-',
                    Novo_PDM: resultado?.Novo_PDM || '-',
                    Desc_Nova: resultado?.Desc_Nova || '-'
                };
            })
        )
    );

    const saidaDir = path.join(os.tmpdir(), 'hera-sidec');
    garantirDiretorio(saidaDir);

    const nomeBase = path.basename(caminhoEntrada, path.extname(caminhoEntrada));
    const caminhoSaida = path.join(saidaDir, `${nomeBase}_resultado_sidec.xlsx`);

    const wbSaida = xlsx.utils.book_new();
    const wsSaida = xlsx.utils.json_to_sheet(resultados, {
        header: ['Item', 'Desc_INCA', 'Cod_Original', 'PDM_Orig', 'Status', 'Novo_Cod', 'Novo_PDM', 'Desc_Nova']
    });

    wsSaida['!cols'] = [
        { wch: 10 },
        { wch: 60 },
        { wch: 18 },
        { wch: 28 },
        { wch: 15 },
        { wch: 18 },
        { wch: 28 },
        { wch: 60 }
    ];

    xlsx.utils.book_append_sheet(wbSaida, wsSaida, 'Resultado');
    xlsx.writeFile(wbSaida, caminhoSaida);

    const resumo = {
        totalLinhasValidas: resultados.length,
        ativos: resultados.filter(r => r.Status === 'Ativo').length,
        inativos: resultados.filter(r => r.Status === 'Inativo').length,
        naoEncontrados: resultados.filter(r => r.Status === 'Não Encontrado').length
    };

    if (onProgress) {
        onProgress({ total, processadas: total, etapa: 'finalizado' });
    }

    return {
        caminhoSaida,
        resumo,
        resultados
    };
}

module.exports = {
    processarArquivoExcelSidec
};