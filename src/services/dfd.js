const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { dataDir, pcaCadastroPath, pcaUnificadoPath, pncpUnificadoPath } = require('../config/paths');

const UASG_FIXA = '250052';

function garantirDiretorio(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function normalizarValor(valor) {
    return String(valor || '').trim();
}

function normalizarCabecalho(texto) {
    return String(texto || '')
        .replace(/^\uFEFF/, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[º°]/g, 'o')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function obterValorPorCabecalho(linha, nomesAceitos) {
    const entradas = Object.entries(linha || {});
    const nomesNormalizados = nomesAceitos.map(normalizarCabecalho);

    for (const [chave, valor] of entradas) {
        const chaveNormalizada = normalizarCabecalho(chave);

        if (nomesNormalizados.includes(chaveNormalizada)) {
            return normalizarValor(valor);
        }
    }

    return '';
}

function listarArquivosPlanilha(diretorio) {
    if (!fs.existsSync(diretorio)) {
        return [];
    }

    return fs.readdirSync(diretorio)
        .filter(nomeArquivo => {
            const nome = String(nomeArquivo || '').toLowerCase().trim();
            return nome.endsWith('.csv') || nome.endsWith('.xlsx');
        })
        .map(nomeArquivo => path.join(diretorio, nomeArquivo));
}

function lerLinhasArquivoPca(caminhoArquivo) {
    const workbook = xlsx.readFile(caminhoArquivo, {
        raw: false
    });

    const linhas = [];

    workbook.SheetNames.forEach(nomeAba => {
        const aba = workbook.Sheets[nomeAba];

        if (!aba) {
            return;
        }

        const dados = xlsx.utils.sheet_to_json(aba, {
            defval: ''
        });

        if (!Array.isArray(dados) || !dados.length) {
            return;
        }

        dados.forEach(linha => {
            linhas.push({
                numeroDfd: obterValorPorCabecalho(linha, [
                    'Nº DFD',
                    'N° DFD',
                    'No DFD',
                    'Nş DFD',
                    'Numero do DFD',
                    'Numero DFD',
                    'DFD'
                ]),
                numeroContratacao: obterValorPorCabecalho(linha, [
                    'Número da contratação',
                    'Numero da contratação',
                    'Número da contratacao',
                    'Numero da contratacao',
                    'Número da contrataçǎo',
                    'Numero da contrataçǎo'
                ]),
                statusContratacao: obterValorPorCabecalho(linha, [
                    'Status da contratação',
                    'Status da contratacao',
                    'Status da contrataçǎo'
                ]),
                situacaoExecucao: obterValorPorCabecalho(linha, [
                    'Situação da Execução',
                    'Situacao da Execucao',
                    'Situaçǎo da Execuçǎo'
                ])
            });
        });
    });

    return linhas;
}

function lerLinhasArquivoPncp(caminhoArquivo) {
    const workbook = xlsx.readFile(caminhoArquivo, {
        raw: false
    });

    const linhas = [];

    workbook.SheetNames.forEach(nomeAba => {
        const aba = workbook.Sheets[nomeAba];

        if (!aba) {
            return;
        }

        const dados = xlsx.utils.sheet_to_json(aba, {
            defval: ''
        });

        if (Array.isArray(dados) && dados.length > 0) {
            // CORREÇÃO: Laço de repetição seguro para planilhas gigantes
            dados.forEach(linha => {
                linhas.push(linha);
            });
        }
    });

    return linhas;
}

function extrairRegistrosPcaPorDfd(numeroDfd) {
    const dfdProcurado = normalizarValor(numeroDfd);
    const mapaContratacoes = new Map();

    if (!fs.existsSync(pcaUnificadoPath)) {
        console.error('Arquivo unificado PCA não encontrado:', pcaUnificadoPath);
        return [];
    }

    const linhas = lerLinhasArquivoPca(pcaUnificadoPath);

    linhas.forEach(linha => {
        const numeroDfdLinha = normalizarValor(linha.numeroDfd);
        const numeroContratacao = normalizarValor(linha.numeroContratacao);

        if (numeroDfdLinha !== dfdProcurado || !numeroContratacao) {
            return;
        }

        const registroAtual = mapaContratacoes.get(numeroContratacao) || {
            numeroContratacao,
            statusContratacao: '',
            situacaoExecucao: ''
        };

        if (!registroAtual.statusContratacao && normalizarValor(linha.statusContratacao)) {
            registroAtual.statusContratacao = normalizarValor(linha.statusContratacao);
        }

        if (!registroAtual.situacaoExecucao && normalizarValor(linha.situacaoExecucao)) {
            registroAtual.situacaoExecucao = normalizarValor(linha.situacaoExecucao);
        }

        mapaContratacoes.set(numeroContratacao, registroAtual);
    });

    return Array.from(mapaContratacoes.values());
}

function extrairLinhasPncpPorIdentificador(identificador) {
    if (!fs.existsSync(pncpUnificadoPath)) {
        console.error('Arquivo unificado PNCP não encontrado:', pncpUnificadoPath);
        return [];
    }

    const identificadorProcurado = normalizarValor(identificador);
    const linhasEncontradas = [];
    const linhas = lerLinhasArquivoPncp(pncpUnificadoPath);

    linhas.forEach(linha => {
        const valorIdentificador = obterValorPorCabecalho(linha, [
            'Identificador da Futura Contratação',
            'Identificador da Futura Contratacao'
        ]);

        if (valorIdentificador === identificadorProcurado) {
            linhasEncontradas.push(linha);
        }
    });

    return linhasEncontradas;
}

function extrairInteiro(valor) {
    const texto = String(valor || '').trim();

    if (!texto) {
        return null;
    }

    const match = texto.match(/\d+/);

    if (!match) {
        return null;
    }

    const numero = parseInt(match[0], 10);

    if (Number.isNaN(numero)) {
        return null;
    }

    return numero;
}

function agruparSequenciaisEmIntervalos(numeros) {
    const numerosValidos = Array.from(
        new Set(
            numeros
                .map(extrairInteiro)
                .filter(numero => Number.isInteger(numero))
        )
    ).sort((a, b) => a - b);

    if (!numerosValidos.length) {
        return '';
    }

    const grupos = [];
    let inicio = numerosValidos[0];
    let fim = numerosValidos[0];

    for (let i = 1; i < numerosValidos.length; i++) {
        const atual = numerosValidos[i];

        if (atual === fim + 1) {
            fim = atual;
            continue;
        }

        grupos.push(inicio === fim ? `${inicio}` : `${inicio} a ${fim}`);
        inicio = atual;
        fim = atual;
    }

    grupos.push(inicio === fim ? `${inicio}` : `${inicio} a ${fim}`);

    return grupos.join(', ');
}

function extrairClassesGruposUnicos(linhas) {
    const classes = new Set();

    linhas.forEach(linha => {
        const valor = obterValorPorCabecalho(linha, [
            'Código da Classificação Superior (Classe/Grupo)',
            'Codigo da Classificacao Superior (Classe/Grupo)',
            'Código da Classificação Superior',
            'Classe/Grupo'
        ]);

        if (valor) {
            classes.add(valor);
        }
    });

    return Array.from(classes).join(', ');
}

function montarInformacoesComplementares(statusContratacao, situacaoExecucao, encontrouPncp) {
    if (encontrouPncp) {
        return '';
    }

    const linhas = [
        'Informações complementares:',
        `Status da contratação: ${statusContratacao || ''}`,
        `Situação da Execução: ${situacaoExecucao || ''}`
    ];

    return linhas.join('\n');
}

function montarBlocoResposta({
    idPcaPncp,
    dataPublicacaoPncp,
    idsAgrupados,
    classesGrupos,
    identificador,
    informacoesComplementares
}) {
    const linhas = [
        `I) ID PCA no PNCP: ${idPcaPncp}`,
        `II) Data de publicação no PNCP: ${dataPublicacaoPncp}`,
        `III) Id do item no PCA: ${idsAgrupados}`,
        `IV) Classe/Grupo: ${classesGrupos}`,
        `V) Identificador da Futura Contratação: ${identificador}`
    ];

    if (informacoesComplementares) {
        linhas.push('');
        linhas.push(informacoesComplementares);
    }

    return linhas.join('\n');
}

function lerCadastroPcaJson() {
    try {
        garantirDiretorio(path.dirname(pcaCadastroPath));

        if (!fs.existsSync(pcaCadastroPath)) {
            fs.writeFileSync(
                pcaCadastroPath,
                JSON.stringify({ anos: {} }, null, 2),
                'utf-8'
            );
        }

        const conteudo = fs.readFileSync(pcaCadastroPath, 'utf-8');
        const json = JSON.parse(conteudo);

        if (!json || typeof json !== 'object') {
            return { anos: {} };
        }

        if (!json.anos || typeof json.anos !== 'object') {
            json.anos = {};
        }

        return json;
    } catch (erro) {
        console.error('Erro ao ler cadastro PCA JSON:', erro);
        return { anos: {} };
    }
}

function salvarCadastroPcaJson(dados) {
    garantirDiretorio(path.dirname(pcaCadastroPath));
    fs.writeFileSync(
        pcaCadastroPath,
        JSON.stringify(dados, null, 2),
        'utf-8'
    );
}

function cadastrarPca({ ano, idPcaPncp, dataPublicacaoPncp }) {
    const anoNormalizado = normalizarValor(ano);
    const idNormalizado = normalizarValor(idPcaPncp);
    const dataNormalizada = normalizarValor(dataPublicacaoPncp);

    if (!/^\d{4}$/.test(anoNormalizado)) {
        return {
            sucesso: false,
            mensagem: '❌ Ano inválido. Informe no formato AAAA, por exemplo: 2026.'
        };
    }

    if (!idNormalizado) {
        return {
            sucesso: false,
            mensagem: '❌ O Id pca PNCP não pode ficar em branco.'
        };
    }

    if (!dataNormalizada) {
        return {
            sucesso: false,
            mensagem: '❌ A Data de publicação no PNCP não pode ficar em branco.'
        };
    }

    const baseAtual = lerCadastroPcaJson();

    baseAtual.anos[anoNormalizado] = {
        ano: anoNormalizado,
        idPcaPncp: idNormalizado,
        dataPublicacaoPncp: dataNormalizada,
        atualizadoEm: new Date().toISOString()
    };

    salvarCadastroPcaJson(baseAtual);

    return {
        sucesso: true,
        mensagem:
            `✅ CadastroPCA salvo com sucesso.\n\n` +
            `Ano do PCA: ${anoNormalizado}\n` +
            `Id pca PNCP: ${idNormalizado}\n` +
            `Data de publicação no PNCP: ${dataNormalizada}\n\n` +
            `Arquivo atualizado: data/pca_cadastro.json`
    };
}

function obterCadastroPcaPorAno(ano) {
    const anoNormalizado = normalizarValor(ano);
    const baseAtual = lerCadastroPcaJson();
    return baseAtual.anos[anoNormalizado] || null;
}

function consultarDfd(numeroDfd) {
    try {
        const numeroInformado = normalizarValor(numeroDfd);

        if (!numeroInformado) {
            return 'Por favor, informe o número do DFD. Exemplo: DFD 268/2025';
        }

        const registrosPca = extrairRegistrosPcaPorDfd(numeroInformado);

        if (!registrosPca.length) {
            return `❌ Nenhum registro foi encontrado para o DFD ${numeroInformado} na planilha unificada do PCA.`;
        }

        const blocos = registrosPca.map(registroPca => {
            const numeroContratacao = registroPca.numeroContratacao;
            const anoDaContratacao = (numeroContratacao.match(/\/(\d{4})$/) || [])[1] || '';
            const cadastroAno = anoDaContratacao ? obterCadastroPcaPorAno(anoDaContratacao) : null;

            const identificador = `${UASG_FIXA}-${numeroContratacao}`;
            const linhasPncp = extrairLinhasPncpPorIdentificador(identificador);
            const encontrouPncp = linhasPncp.length > 0;

            const idsAgrupados = agruparSequenciaisEmIntervalos(
                linhasPncp.map(linha => obterValorPorCabecalho(linha, ['Id do item no PCA', 'Id do item']))
            );

            const classesGrupos = extrairClassesGruposUnicos(linhasPncp);

            const informacoesComplementares = montarInformacoesComplementares(
                registroPca.statusContratacao,
                registroPca.situacaoExecucao,
                encontrouPncp
            );

            return montarBlocoResposta({
                idPcaPncp: cadastroAno?.idPcaPncp || '',
                dataPublicacaoPncp: cadastroAno?.dataPublicacaoPncp || '',
                idsAgrupados,
                classesGrupos,
                identificador,
                informacoesComplementares
            });
        });

        return blocos.join('\n\n');
    } catch (erro) {
        console.error('Erro ao consultar DFD:', erro);
        return '❌ Ocorreu um erro ao processar a consulta do DFD.';
    }
}

module.exports = {
    consultarDfd,
    cadastrarPca,
    obterCadastroPcaPorAno
};