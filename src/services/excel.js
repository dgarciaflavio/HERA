const xlsx = require('xlsx');
const { planilhaPath } = require('../config/paths');

function removerAcentos(texto) {
    if (!texto) {
        return '';
    }

    return String(texto)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function normalizarTexto(texto) {
    return removerAcentos(texto).toLowerCase();
}

function limparCodigo(texto) {
    return String(texto || '')
        .trim()
        .toUpperCase();
}

function limparCodigoSemZeros(texto) {
    return limparCodigo(texto).replace(/^0+/, '');
}

function somenteLetras(texto) {
    return limparCodigo(texto).replace(/[^A-Z]/g, '');
}

function somenteNumeros(texto) {
    return limparCodigo(texto).replace(/\D/g, '');
}

function carregarDadosDaPlanilha() {
    const workbook = xlsx.readFile(planilhaPath);
    const aba = workbook.Sheets[workbook.SheetNames[0]];

    return xlsx.utils.sheet_to_json(aba, { defval: '', range: 1 });
}

function formatarDataExcel(valor) {
    if (!valor) {
        return 'N/A';
    }

    if (typeof valor === 'number') {
        const dataObj = new Date((valor - 25569) * 86400 * 1000);

        if (!isNaN(dataObj.getTime())) {
            return dataObj.toLocaleDateString('pt-BR');
        }
    }

    const texto = String(valor).trim();
    return texto || 'N/A';
}

function obterValorOuPadrao(valor, padrao = '0') {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
        return padrao;
    }

    return String(valor).trim();
}

function montarMapaDeProcessos(linhasDoMesmoItem) {
    const mapa = new Map();

    linhasDoMesmoItem.forEach(linha => {
        const chaves = Object.keys(linha);

        for (let i = 0; i < chaves.length; i++) {
            const chaveOriginal = chaves[i];
            const chaveTrim = chaveOriginal.trim();

            if (chaveTrim.startsWith('Processo')) {
                const processo = String(linha[chaveOriginal] || '').trim();

                if (!processo || processo === '0' || processo.toLowerCase() === 'n/a') {
                    continue;
                }

                let quantidade = 'N/A';

                // A MÁGICA: Pega a coluna imediatamente à direita
                if (i + 1 < chaves.length) {
                    const proximaChave = chaves[i + 1];
                    if (proximaChave.trim().toUpperCase().startsWith('QTDE')) {
                        quantidade = String(linha[proximaChave] || '').trim() || 'N/A';
                    }
                }

                // Salva apenas uma vez para não somar linhas repetidas
                if (!mapa.has(processo) || mapa.get(processo) === 'N/A') {
                    mapa.set(processo, quantidade);
                }
            }
        }
    });

    return mapa;
}

function montarMapaDeAes(linhasDoMesmoItem) {
    const mapa = new Map();

    linhasDoMesmoItem.forEach(linha => {
        const chaves = Object.keys(linha);

        for (let i = 0; i < chaves.length; i++) {
            const chaveOriginal = chaves[i];
            const chaveTrim = chaveOriginal.trim();

            if (chaveTrim.startsWith('AE') && !chaveTrim.includes('Empenhar') && !chaveTrim.includes('Qtde')) {
                const ae = String(linha[chaveOriginal] || '').trim();

                if (!ae || ae === '0' || ae.toLowerCase() === 'n/a') {
                    continue;
                }

                let quantidade = 'N/A';

                // A MÁGICA: Pega a coluna imediatamente à direita
                if (i + 1 < chaves.length) {
                    const proximaChave = chaves[i + 1];
                    if (proximaChave.trim().toUpperCase().startsWith('QTDE')) {
                        quantidade = String(linha[proximaChave] || '').trim() || 'N/A';
                    }
                }

                if (!mapa.has(ae) || mapa.get(ae) === 'N/A') {
                    mapa.set(ae, quantidade);
                }
            }
        }
    });

    return mapa;
}

function montarListaDeEmpenhos(linhasDoMesmoItem) {
    const empenhosMap = new Map();

    linhasDoMesmoItem.forEach(linha => {
        const numEmpenho = String(linha['Num.Empenho'] || '').trim();
        const qtdeReceberStr = String(linha['Qtde a Receber'] || '').trim();
        const valorUnitario = String(linha['Valor Unitário'] || '').trim();
        const fornecedor = String(linha['Fornecedor Empenho'] || '').trim();

        if (!numEmpenho || numEmpenho === '0' || numEmpenho.toLowerCase() === 'n/a') {
            return;
        }

        let anoEmpenho = null;
        const matchAno = numEmpenho.match(/^(\d{4})/);
        if (matchAno) {
            anoEmpenho = parseInt(matchAno[1], 10);
        }

        if (!empenhosMap.has(numEmpenho)) {
            empenhosMap.set(numEmpenho, {
                empenho: numEmpenho,
                ano: anoEmpenho,
                quantidade: qtdeReceberStr || '0',
                valorUnitario: valorUnitario || 'Não informado',
                fornecedor: fornecedor || 'Não informado'
            });
        }
    });

    return Array.from(empenhosMap.values());
}

function obterItensSimilares(dados, itemPrincipal) {
    const codigoPrincipal = String(itemPrincipal['Item'] || '').trim();

    const descricaoLimpa = String(itemPrincipal['Descrição'] || '')
        .replace(/[^a-zA-Z0-9À-ÿ\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!descricaoLimpa) {
        return [];
    }

    const palavrasChaveBase = descricaoLimpa
        .split(' ')
        .slice(0, 3)
        .join(' ')
        .toLowerCase();

    if (!palavrasChaveBase) {
        return [];
    }

    const encontrados = dados.filter(linha => {
        const descricaoLinha = String(linha['Descrição'] || '')
            .replace(/[^a-zA-Z0-9À-ÿ\s]/g, '')
            .toLowerCase();

        const codigoLinha = String(linha['Item'] || '').trim();

        return descricaoLinha.includes(palavrasChaveBase) && codigoLinha !== codigoPrincipal;
    });

    const unicos = [];
    const codigosVistos = new Set();

    encontrados.forEach(item => {
        const codigo = String(item['Item'] || '').trim();

        if (codigo && !codigosVistos.has(codigo)) {
            codigosVistos.add(codigo);
            unicos.push(item);
        }
    });

    return unicos.slice(0, 7);
}

function montarRespostaDetalhada(dados, principal) {
    const codigoPrincipal = String(principal['Item'] || '').trim();
    const linhasDoMesmoItem = dados.filter(linha => String(linha['Item'] || '').trim() === codigoPrincipal);

    const vencimentoAta = formatarDataExcel(principal['Venc.Ata']);
    const mapaProcessos = montarMapaDeProcessos(linhasDoMesmoItem);
    const mapaAes = montarMapaDeAes(linhasDoMesmoItem);
    const listaEmpenhosBruta = montarListaDeEmpenhos(linhasDoMesmoItem);
    const itensSimilares = obterItensSimilares(dados, principal);

    // Validação de Empenhos
    const anoAtual = new Date().getFullYear();
    const empenhosValidos = [];
    let temAnoAtual = false;
    let temAnoAnterior = false;
    const empenhosAntigos = [];

    listaEmpenhosBruta.forEach(emp => {
        if (emp.ano === anoAtual) {
            empenhosValidos.push(emp);
            temAnoAtual = true;
        } else if (emp.ano === anoAtual - 1) {
            empenhosValidos.push(emp);
            temAnoAnterior = true;
        } else if (emp.ano && emp.ano < anoAtual - 1) {
            empenhosAntigos.push(emp);
        } else if (!emp.ano) {
            // Fallback caso não seja possível ler o ano
            empenhosValidos.push(emp);
        }
    });

    let resposta = `*Informações do Item:*\n\n`;
    resposta += `*Item:* ${codigoPrincipal}\n`;
    resposta += `*Descrição:* ${principal['Descrição'] || 'N/A'}\n`;
    resposta += `*Saldo Atual:* ${obterValorOuPadrao(principal['Saldo Atual'])}\n`;
    resposta += `*CMM12:* ${obterValorOuPadrao(principal['CMM12'])}\n`;
    resposta += `*Saldo em Dias:* ${obterValorOuPadrao(principal['Saldo em Dias'])}\n`;
    resposta += `*Obs:* ${principal['Obs'] || 'Nenhuma'}\n\n`;
    resposta += `*Venc. Ata:* ${vencimentoAta}\n`;
    resposta += `*Saldo da Ata:* ${obterValorOuPadrao(principal['Saldo da Ata'])}\n\n`;

    if (empenhosValidos.length > 0) {
        resposta += `*Empenho(s) a Receber:*\n`;
        empenhosValidos.forEach(emp => {
            resposta += `Empenho: ${emp.empenho}\n`;
            resposta += `Quantidade: ${emp.quantidade}\n`;
            resposta += `Valor Unit.: ${emp.valorUnitario}\n`;
            resposta += `Fornecedor: ${emp.fornecedor}\n\n`;
        });
    }

    // Avisos de sobreposição/cancelamento
    if (temAnoAtual && temAnoAnterior) {
        resposta += `⚠️ *Aviso de Empenho:* Constam empenhos de ${anoAtual} e ${anoAtual - 1}. Sugere-se avaliar o cancelamento do saldo do empenho de ${anoAtual - 1}.\n\n`;
    }

    if (empenhosAntigos.length > 0) {
        resposta += `⚠️ *Atenção:* Há empenho(s) antigo(s) na grade. Sugestão de verificação para cancelamento de saldo:\n`;
        empenhosAntigos.forEach(emp => {
            resposta += `- ${emp.empenho} (Fornecedor: ${emp.fornecedor})\n`;
        });
        resposta += `\n`;
    }

    if (mapaProcessos.size > 0) {
        resposta += `*Processo(s)          | Quantidade*\n`;
        mapaProcessos.forEach((quantidade, processo) => {
            resposta += `${processo} | ${quantidade}\n`;
        });
        resposta += `\n`;
    } else {
        resposta += `*Processo(s):* Nenhum\n\n`;
    }

    if (mapaAes.size > 0) {
        resposta += `*AE(s): | Quantidade*\n`;
        mapaAes.forEach((quantidade, ae) => {
            resposta += `${ae} | ${quantidade}\n`;
        });
    } else {
        resposta += `*AE(s):* Nenhum\n`;
    }

    if (itensSimilares.length > 0) {
        resposta += `\n\n💡 *Outros itens similares na grade:*\n`;

        itensSimilares.forEach(similar => {
            const saldo = obterValorOuPadrao(similar['Saldo Atual']);
            resposta += `👉 *${String(similar['Item'] || '').trim()}* - ${similar['Descrição']} (Estoque ${saldo})\n`;
        });
    }

    return resposta.trim();
}

function buscarPorCodigoExato(dados, termoBusca) {
    const termoCodigo = limparCodigo(termoBusca);
    const termoCodigoSemZeros = limparCodigoSemZeros(termoBusca);

    return dados.find(linha => {
        const codigoLinha = limparCodigo(linha['Item']);
        const codigoLinhaSemZeros = limparCodigoSemZeros(linha['Item']);

        return codigoLinha === termoCodigo || codigoLinhaSemZeros === termoCodigoSemZeros;
    });
}

function buscarPorDescricao(dados, termoBusca) {
    const termoNormalizado = normalizarTexto(termoBusca);

    if (!termoNormalizado) {
        return [];
    }

    const palavrasBusca = termoNormalizado.split(' ').filter(Boolean);

    const encontrados = dados.filter(linha => {
        const descricao = normalizarTexto(linha['Descrição']);
        const codigo = normalizarTexto(linha['Item']);
        const familia = normalizarTexto(linha['Família']);
        const textoLinha = `${codigo} ${descricao} ${familia}`;

        return palavrasBusca.every(palavra => textoLinha.includes(palavra));
    });

    const unicos = [];
    const codigosVistos = new Set();

    encontrados.forEach(linha => {
        const codigo = limparCodigo(linha['Item']);

        if (codigo && !codigosVistos.has(codigo)) {
            codigosVistos.add(codigo);
            unicos.push(linha);
        }
    });

    return unicos;
}

function textoPedeCodigo(termoBusca) {
    const texto = normalizarTexto(termoBusca);

    return (
        texto.includes('codigo da ') ||
        texto.includes('código da ') ||
        texto.includes('codigo do ') ||
        texto.includes('código do ') ||
        texto.includes('qual o codigo') ||
        texto.includes('qual o código') ||
        texto.includes('me fala o codigo') ||
        texto.includes('me fala o código')
    );
}

function extrairDescricaoDoPedidoDeCodigo(termoBusca) {
    const textoOriginal = String(termoBusca || '').trim();

    const padroes = [
        /codigo da (.+)/i,
        /código da (.+)/i,
        /codigo do (.+)/i,
        /código do (.+)/i,
        /qual o codigo da (.+)/i,
        /qual o código da (.+)/i,
        /qual o codigo do (.+)/i,
        /qual o código do (.+)/i,
        /me fala o codigo da (.+)/i,
        /me fala o código da (.+)/i,
        /me fala o codigo do (.+)/i,
        /me fala o código do (.+)/i
    ];

    for (const padrao of padroes) {
        const match = textoOriginal.match(padrao);
        if (match && match[1]) {
            return match[1].trim();
        }
    }

    return textoOriginal;
}

function montarRespostaComCodigos(itensEncontrados, termoBuscaOriginal) {
    if (!itensEncontrados.length) {
        return `Desculpe, não encontrei nenhuma informação sobre "${termoBuscaOriginal}" na base.`;
    }

    if (itensEncontrados.length === 1) {
        const item = itensEncontrados[0];
        return `Encontrei 1 item para "${termoBuscaOriginal}":\n\n👉 *${String(item['Item']).trim()}* - ${item['Descrição']}`;
    }

    let resposta = `Encontrei ${itensEncontrados.length} código(s) relacionado(s) a "${termoBuscaOriginal}":\n\n`;

    itensEncontrados.slice(0, 15).forEach(item => {
        resposta += `👉 *${String(item['Item']).trim()}* - ${item['Descrição']}\n`;
    });

    if (itensEncontrados.length > 15) {
        resposta += `\n*(Mostrando os 15 primeiros de ${itensEncontrados.length} resultados)*`;
    }

    return resposta.trim();
}

function calcularDistanciaLevenshtein(a, b) {
    const textoA = String(a || '');
    const textoB = String(b || '');

    const linhas = textoB.length + 1;
    const colunas = textoA.length + 1;
    const matriz = Array.from({ length: linhas }, () => Array(colunas).fill(0));

    for (let i = 0; i < linhas; i++) {
        matriz[i][0] = i;
    }

    for (let j = 0; j < colunas; j++) {
        matriz[0][j] = j;
    }

    for (let i = 1; i < linhas; i++) {
        for (let j = 1; j < colunas; j++) {
            const custo = textoA[j - 1] === textoB[i - 1] ? 0 : 1;

            matriz[i][j] = Math.min(
                matriz[i - 1][j] + 1,
                matriz[i][j - 1] + 1,
                matriz[i - 1][j - 1] + custo
            );
        }
    }

    return matriz[linhas - 1][colunas - 1];
}

function termoPareceCodigo(termoBusca) {
    const termo = limparCodigo(termoBusca);
    return /^[A-Z]?\d{3,10}$/.test(termo);
}

function calcularScoreDeCodigo(termoBusca, codigoCandidato) {
    const termoOriginal = limparCodigo(termoBusca);
    const candidatoOriginal = limparCodigo(codigoCandidato);

    const termoNumeros = somenteNumeros(termoOriginal);
    const candidatoNumeros = somenteNumeros(candidatoOriginal);

    const termoLetras = somenteLetras(termoOriginal);
    const candidatoLetras = somenteLetras(candidatoOriginal);

    let score = 1000;

    const distanciaOriginal = calcularDistanciaLevenshtein(termoOriginal, candidatoOriginal);
    score = Math.min(score, distanciaOriginal * 10);

    if (termoNumeros && candidatoNumeros) {
        const distanciaNumeros = calcularDistanciaLevenshtein(termoNumeros, candidatoNumeros);
        score = Math.min(score, distanciaNumeros * 4);

        if (candidatoNumeros === termoNumeros) {
            score -= 30;
        }

        if (candidatoNumeros.endsWith(termoNumeros) || termoNumeros.endsWith(candidatoNumeros)) {
            score -= 20;
        }

        if (candidatoNumeros.includes(termoNumeros) || termoNumeros.includes(candidatoNumeros)) {
            score -= 10;
        }

        if (termoNumeros.length >= 4 && candidatoNumeros.length >= 4) {
            const ultimos4Termo = termoNumeros.slice(-4);
            const ultimos4Candidato = candidatoNumeros.slice(-4);
            if (ultimos4Termo === ultimos4Candidato) {
                score -= 12;
            }
        }
    }

    if (termoLetras && candidatoLetras) {
        if (termoLetras === candidatoLetras) {
            score -= 12;
        } else {
            score += 8;
        }
    }

    if (!termoLetras && candidatoLetras) {
        score += 3;
    }

    if (termoLetras && !candidatoLetras) {
        score += 6;
    }

    const diferencaTamanho = Math.abs(candidatoOriginal.length - termoOriginal.length);
    score += diferencaTamanho * 2;

    return score;
}

function buscarSugestoesDeCodigo(dados, termoBusca) {
    const unicos = new Map();

    dados.forEach(linha => {
        const codigo = limparCodigo(linha['Item']);
        if (codigo && !unicos.has(codigo)) {
            unicos.set(codigo, linha);
        }
    });

    const avaliados = Array.from(unicos.values())
        .map(item => ({
            item,
            score: calcularScoreDeCodigo(termoBusca, item['Item'])
        }))
        .filter(registro => registro.score < 60)
        .sort((a, b) => a.score - b.score);

    return avaliados.slice(0, 5).map(registro => registro.item);
}

function montarRespostaComSugestaoDeCodigo(sugestoes, termoOriginal) {
    if (!sugestoes.length) {
        return `Desculpe, não encontrei nenhuma informação sobre "${termoOriginal}" na base.`;
    }

    if (sugestoes.length === 1) {
        const item = sugestoes[0];
        return `Desculpe, não encontrei nenhuma informação sobre "${termoOriginal}" na base.\n\n💡 Você quis dizer:\n👉 *${String(item['Item']).trim()}* - ${item['Descrição']}`;
    }

    let resposta = `Desculpe, não encontrei nenhuma informação sobre "${termoOriginal}" na base.\n\n💡 Encontrei alguns códigos parecidos. Você quis dizer um destes?\n\n`;

    sugestoes.forEach(item => {
        resposta += `👉 *${String(item['Item']).trim()}* - ${item['Descrição']}\n`;
    });

    return resposta.trim();
}

function buscarItem(termoBusca) {
    try {
        const dados = carregarDadosDaPlanilha();
        const termoOriginal = String(termoBusca || '').trim();

        if (!termoOriginal) {
            return 'Por favor, informe um item ou uma descrição para pesquisa.';
        }

        if (textoPedeCodigo(termoOriginal)) {
            const descricaoProcurada = extrairDescricaoDoPedidoDeCodigo(termoOriginal);
            const itensPorDescricao = buscarPorDescricao(dados, descricaoProcurada);

            return montarRespostaComCodigos(itensPorDescricao, descricaoProcurada);
        }

        const itemExato = buscarPorCodigoExato(dados, termoOriginal);

        if (itemExato) {
            return montarRespostaDetalhada(dados, itemExato);
        }

        const itensEncontrados = buscarPorDescricao(dados, termoOriginal);

        if (itensEncontrados.length === 1) {
            return montarRespostaDetalhada(dados, itensEncontrados[0]);
        }

        if (itensEncontrados.length > 1) {
            let resposta = `Encontrei ${itensEncontrados.length} opções diferentes para "${termoOriginal}". Por favor, me informe qual destes códigos você deseja detalhar:\n\n`;

            itensEncontrados.slice(0, 10).forEach(item => {
                const saldo = obterValorOuPadrao(item['Saldo Atual']);
                resposta += `👉 *${String(item['Item']).trim()}* - ${item['Descrição']} (Estoque ${saldo})\n`;
            });

            if (itensEncontrados.length > 10) {
                resposta += `\n*(Mostrando os 10 primeiros de ${itensEncontrados.length} resultados)*`;
            }

            return resposta.trim();
        }

        if (termoPareceCodigo(termoOriginal)) {
            const sugestoes = buscarSugestoesDeCodigo(dados, termoOriginal);
            return montarRespostaComSugestaoDeCodigo(sugestoes, termoOriginal);
        }

        return `Desculpe, não encontrei nenhuma informação sobre "${termoOriginal}" na base.`;
    } catch (erro) {
        console.error('Erro ao ler a planilha:', erro);
        return 'Ocorreu um erro ao tentar acessar o arquivo Excel.';
    }
}

function buscarItensEmLote(codigos = []) {
    const lista = Array.isArray(codigos)
        ? codigos.map(codigo => String(codigo || '').trim()).filter(Boolean)
        : [];

    if (!lista.length) {
        return [];
    }

    return lista.map(codigo => ({
        codigo,
        resposta: buscarItem(codigo)
    }));
}

function contarItensGrade() {
    try {
        const dados = carregarDadosDaPlanilha();
        const codigosVistos = new Set();

        dados.forEach(linha => {
            const codigo = String(linha['Item'] || '').trim();

            if (codigo) {
                codigosVistos.add(codigo);
            }
        });

        return codigosVistos.size;
    } catch (erro) {
        console.error('Erro ao contar a grade:', erro);
        return 0;
    }
}

module.exports = {
    buscarItem,
    buscarItensEmLote,
    contarItensGrade
};