const pdfParse = require('pdf-parse-new');
const { iniciarBancoPregoes, buscarPregaoCache, salvarPregaoCache } = require('./pregoesCache');

async function consultarEmpenhoARP(numeroAta, unidadeGerenciadora) {
    try {
        const urlGoverno = `https://dadosabertos.compras.gov.br/modulo-arp/4_consultarEmpenhosSaldoItem?numeroAta=${numeroAta}&unidadeGerenciadora=${unidadeGerenciadora}`;

        const resposta = await fetch(urlGoverno, {
            method: 'GET',
            headers: { 'Accept': '*/*' }
        });

        if (!resposta.ok) {
            if (resposta.status === 404) return `⚠️ Não encontrei dados para a Ata *${numeroAta}* na UASG *${unidadeGerenciadora}*.`;
            return `❌ Erro ao consultar o sistema de compras (Código: ${resposta.status}).`;
        }

        const dados = await resposta.json();

        if (!dados.resultado || dados.resultado.length === 0) {
            return `⚠️ Nenhum empenho encontrado para esta Ata e UASG.`;
        }

        const empenho = dados.resultado[0];

        let texto = `🔎 *Consulta de Saldo e Empenho (ARP)*\n\n`;
        texto += `*Item:* ${empenho.numeroItem || 'N/A'}\n`;
        texto += `*Unidade:* ${empenho.unidade || 'N/A'}\n`;
        texto += `*Qtd. Registrada:* ${empenho.quantidadeRegistrada || 0}\n`;
        texto += `*Qtd. Empenhada:* ${empenho.quantidadeEmpenhada || 0}\n`;
        texto += `*Saldo para Empenho:* ${empenho.saldoEmpenho || 0}\n\n`;

        let dataAtualizacao = 'N/A';
        if (empenho.dataHoraAtualizacao) {
            const dataObj = new Date(empenho.dataHoraAtualizacao);
            dataAtualizacao = dataObj.toLocaleString('pt-BR');
        }

        texto += `_Última atualização no Compras.gov.br: ${dataAtualizacao}_`;

        return texto;
    } catch (erro) {
        console.error('Erro ao consultar a API de compras:', erro);
        return '❌ Ocorreu um erro de conexão ao tentar consultar os dados da ata. Tente novamente mais tarde.';
    }
}

function normalizarNumeroPregao(numeroPregao) {
    const texto = String(numeroPregao || '').trim();

    let numeroLimpo = '';
    let ano = '';

    if (texto.includes('/')) {
        const partes = texto.split('/');
        numeroLimpo = String(partes[0]).replace(/\D/g, '');
        ano = String(partes[1]).replace(/\D/g, '');
    } else {
        const apenasNumeros = texto.replace(/\D/g, '');

        if (apenasNumeros.length >= 5) {
            ano = apenasNumeros.slice(-4);
            numeroLimpo = apenasNumeros.slice(0, -4);
        } else {
            numeroLimpo = apenasNumeros;
            ano = new Date().getFullYear().toString();
        }
    }

    return { numeroLimpo, ano };
}

function obterListaResultado(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.resultado)) return payload.resultado;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.itens)) return payload.itens;
    return [];
}

function obterNumeroItem(item) {
    const valor = item.numeroItemCompra ?? item.numeroItemPncp ?? item.numeroItem ?? item.item ?? '999999';
    const numero = parseInt(String(valor).replace(/\D/g, ''), 10);
    return Number.isNaN(numero) ? 999999 : numero;
}

function formatarMoeda(valor) {
    if (valor === null || valor === undefined || valor === '') {
        return 'N/A';
    }

    if (typeof valor === 'string') {
        const texto = valor.trim();

        if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(texto)) {
            return `R$ ${texto}`;
        }

        const normalizado = texto.replace(/\./g, '').replace(',', '.');
        const numero = Number(normalizado);

        if (Number.isFinite(numero)) {
            return numero.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL'
            });
        }

        return texto;
    }

    const numero = Number(valor);

    if (!Number.isFinite(numero)) {
        return 'N/A';
    }

    return numero.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function consolidarItens(itens) {
    const mapa = new Map();

    itens.forEach(item => {
        const numeroItem = String(
            item.numeroItemCompra ??
            item.numeroItemPncp ??
            item.numeroItem ??
            item.item ??
            'N/A'
        ).trim();

        const descricao = String(
            item.descricaoResumida ??
            item.descricao ??
            item.objetoCompra ??
            'N/A'
        ).trim();

        const situacao = String(
            item.situacaoCompraItemNome ??
            item.situacaoItem ??
            item.situacao ??
            'N/A'
        ).trim();

        const fornecedor = String(
            item.nomeFornecedor ??
            item.nomeRazaoSocialFornecedor ??
            item.fornecedor ??
            ''
        ).trim();

        const valor =
            item.valorTotalResultado ??
            item.valorTotal ??
            item.valorUnitarioResultado ??
            item.valorUnitario ??
            item.valorHomologado ??
            null;

        const chave = `${numeroItem}|||${descricao}`;

        if (!mapa.has(chave)) {
            mapa.set(chave, {
                numeroItem,
                descricao,
                situacoes: [],
                fornecedor: '',
                valor
            });
        }

        const registro = mapa.get(chave);

        if (situacao && !registro.situacoes.includes(situacao)) {
            registro.situacoes.push(situacao);
        }

        if (fornecedor && !registro.fornecedor) {
            registro.fornecedor = fornecedor;
        }

        if (
            (registro.valor === null || registro.valor === undefined || registro.valor === '') &&
            valor !== null &&
            valor !== undefined &&
            valor !== ''
        ) {
            registro.valor = valor;
        }
    });

    return Array.from(mapa.values()).sort((a, b) => {
        const numeroA = parseInt(String(a.numeroItem).replace(/\D/g, ''), 10);
        const numeroB = parseInt(String(b.numeroItem).replace(/\D/g, ''), 10);

        const valorA = Number.isNaN(numeroA) ? 999999 : numeroA;
        const valorB = Number.isNaN(numeroB) ? 999999 : numeroB;

        return valorA - valorB;
    });
}

async function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function buscarTodosItensDaCompra(idCompra) {
    let pagina = 1;
    const tamanhoPagina = 50;
    let todosItens = [];

    while (true) {
        const urlItens = `https://dadosabertos.compras.gov.br/modulo-contratacoes/2.1_consultarItensContratacoes_PNCP_14133_Id?tipo=idCompra&codigo=${idCompra}&tamanhoPagina=${tamanhoPagina}&pagina=${pagina}`;

        let ultimaResposta = null;
        let ultimoErro = null;

        for (let tentativa = 1; tentativa <= 3; tentativa++) {
            try {
                const respostaItens = await fetch(urlItens, {
                    method: 'GET',
                    headers: { Accept: 'application/json' }
                });

                ultimaResposta = respostaItens;

                if (respostaItens.ok) {
                    const dadosItens = await respostaItens.json();
                    const itensPagina = obterListaResultado(dadosItens);

                    if (!itensPagina.length) {
                        return todosItens;
                    }

                    todosItens = todosItens.concat(itensPagina);

                    if (itensPagina.length < tamanhoPagina) {
                        return todosItens;
                    }

                    pagina += 1;
                    ultimoErro = null;
                    break;
                }

                if (respostaItens.status === 504 || respostaItens.status === 502 || respostaItens.status === 503) {
                    if (tentativa < 3) {
                        await esperar(1200 * tentativa);
                        continue;
                    }
                }

                throw new Error(`Erro ao buscar os itens do pregão. Código: ${respostaItens.status}`);
            } catch (erro) {
                ultimoErro = erro;

                if (tentativa < 3) {
                    await esperar(1200 * tentativa);
                    continue;
                }
            }
        }

        if (ultimoErro) {
            throw ultimoErro;
        }

        if (ultimaResposta && !ultimaResposta.ok) {
            throw new Error(`Erro ao buscar os itens do pregão. Código: ${ultimaResposta.status}`);
        }
    }
}

async function consultarItensPregao(numeroPregao) {
    try {
        const uasg = '250052';
        const { numeroLimpo, ano } = normalizarNumeroPregao(numeroPregao);

        const urlBuscaPNCP = `https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133?unidadeOrgaoCodigoUnidade=${uasg}&codigoModalidade=5&dataPublicacaoPncpInicial=${ano}-01-01&dataPublicacaoPncpFinal=${ano}-12-31&tamanhoPagina=500`;

        const respostaBusca = await fetch(urlBuscaPNCP, {
            method: 'GET',
            headers: { Accept: 'application/json' }
        });

        if (!respostaBusca.ok) {
            return `❌ Erro ao consultar a base principal do Governo (PNCP). Código: ${respostaBusca.status}`;
        }

        const dadosBusca = await respostaBusca.json();
        const contratacoes = dadosBusca.resultado || [];
        const pregaoEncontrado = contratacoes.find(p => String(p.numeroCompra) === numeroLimpo);

        if (!pregaoEncontrado) {
            return `⚠️ *Aviso da Hera:* O pregão *${numeroLimpo}/${ano}* não foi encontrado na base de dados.`;
        }

        const idCompra = pregaoEncontrado.idCompra;

        if (!idCompra) {
            return `❌ A contratação do pregão *${numeroLimpo}/${ano}* foi encontrada, mas o PNCP não retornou o identificador da compra.`;
        }

        let todosItensBrutos = [];

        try {
            todosItensBrutos = await buscarTodosItensDaCompra(idCompra);
        } catch (erroItens) {
            const situacao = pregaoEncontrado.situacaoCompraNomePncp || 'N/A';

            return (
                `⚠️ *Pregão localizado, mas a API de itens do PNCP está instável no momento.*\n\n` +
                `*Pregão Nº:* ${numeroLimpo}/${ano}\n` +
                `*Situação Geral:* ${situacao}\n` +
                `*ID da Compra:* ${idCompra}\n\n` +
                `A consulta dos itens retornou erro temporário (${erroItens.message}). ` +
                `Tente novamente em alguns instantes.`
            );
        }

        if (!todosItensBrutos.length) {
            return `⚠️ O Pregão *${numeroLimpo}/${ano}* foi encontrado, mas ainda não possui itens cadastrados na base aberta.`;
        }

        const itensOrdenados = [...todosItensBrutos].sort((a, b) => obterNumeroItem(a) - obterNumeroItem(b));
        const itensConsolidados = consolidarItens(itensOrdenados);

        let texto = `🏛️ *Consulta de Pregão (PNCP - Nova Lei)*\n`;
        texto += `*Pregão Nº:* ${numeroLimpo}/${ano}\n`;
        texto += `*Situação Geral:* ${pregaoEncontrado.situacaoCompraNomePncp || 'N/A'}\n`;
        texto += `*ID da Compra:* ${idCompra}\n`;
        texto += `*Total de registros retornados pela API:* ${todosItensBrutos.length}\n`;
        texto += `*Total de itens consolidados:* ${itensConsolidados.length}\n\n`;

        itensConsolidados.forEach(item => {
            texto += `*Item:* ${item.numeroItem}\n`;
            texto += `*Descrição:* ${item.descricao}\n`;

            if (item.situacoes.length === 1) {
                texto += `*Situação:* ${item.situacoes[0]}\n`;
            } else {
                texto += `*Situações:* ${item.situacoes.join(' | ')}\n`;
            }

            if (item.fornecedor) {
                texto += `*Vencedor:* ${item.fornecedor}\n`;
            }

            texto += `*Valor:* ${formatarMoeda(item.valor)}\n`;
            texto += `--------------------\n`;
        });

        return texto.trim();
    } catch (erro) {
        console.error('Erro ao consultar a API PNCP:', erro);
        return '❌ Ocorreu um erro de conexão ao tentar buscar o pregão. Tente novamente mais tarde.';
    }
}

async function lerEditalPregao(numeroPregao) {
    try {
        const uasg = '250052';
        let numeroLimpo = '';
        let ano = '';

        if (numeroPregao.includes('/')) {
            const partes = numeroPregao.split('/');
            numeroLimpo = String(partes[0]).replace(/\D/g, '');
            ano = String(partes[1]).replace(/\D/g, '');
        } else {
            const apenasNumeros = String(numeroPregao).replace(/\D/g, '');
            if (apenasNumeros.length >= 5) {
                ano = apenasNumeros.slice(-4);
                numeroLimpo = apenasNumeros.slice(0, -4);
            } else {
                numeroLimpo = apenasNumeros;
                ano = new Date().getFullYear().toString();
            }
        }

        const urlBusca = `https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133?unidadeOrgaoCodigoUnidade=${uasg}&codigoModalidade=5&dataPublicacaoPncpInicial=${ano}-01-01&dataPublicacaoPncpFinal=${ano}-12-31&tamanhoPagina=500`;

        const respostaBusca = await fetch(urlBusca, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!respostaBusca.ok) return `❌ Erro ao consultar a base para localizar o edital. Código: ${respostaBusca.status}`;

        const dadosBusca = await respostaBusca.json();
        const pregaoEncontrado = (dadosBusca.resultado || []).find(p => String(p.numeroCompra) === numeroLimpo);

        if (!pregaoEncontrado) {
            return `⚠️ O pregão *${numeroLimpo}/${ano}* não foi encontrado para baixar o Edital.`;
        }

        let cnpj = pregaoEncontrado.orgaoEntidadeCnpj || (pregaoEncontrado.orgaoEntidade && pregaoEncontrado.orgaoEntidade.cnpj);
        let sequencial = pregaoEncontrado.sequencialCompra;

        if (!cnpj || !sequencial) {
            const controle = pregaoEncontrado.numeroControlePNCP || pregaoEncontrado.numeroControlePncp;
            if (controle) {
                const match = controle.match(/^(\d{14})-1-(\d+)\/\d{4}$/);
                if (match) {
                    cnpj = match[1];
                    sequencial = match[2];
                }
            }
        }

        if (!cnpj || !sequencial) {
            return `❌ Erro: Não foi possível extrair o CNPJ e o Sequencial desta contratação para acessar os documentos.`;
        }

        cnpj = String(cnpj).replace(/\D/g, '');

        let urlDocs = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/documentos`;
        let respostaDocs = await fetch(urlDocs, { method: 'GET', headers: { 'Accept': 'application/json' } });

        if (!respostaDocs.ok || respostaDocs.status === 404) {
            urlDocs = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/arquivos`;
            respostaDocs = await fetch(urlDocs, { method: 'GET', headers: { 'Accept': 'application/json' } });
        }

        if (!respostaDocs.ok) {
            return `⚠️ A Hera encontrou a contratação, mas a API de Documentos do PNCP bloqueou a leitura (Status ${respostaDocs.status}).`;
        }

        const dadosDocs = await respostaDocs.json();

        let listaDocumentos = [];
        if (Array.isArray(dadosDocs)) listaDocumentos = dadosDocs;
        else if (dadosDocs.data && Array.isArray(dadosDocs.data)) listaDocumentos = dadosDocs.data;
        else if (dadosDocs.resultado && Array.isArray(dadosDocs.resultado)) listaDocumentos = dadosDocs.resultado;

        if (listaDocumentos.length === 0) {
            return `⚠️ O PNCP não retornou nenhum documento anexo para este pregão.`;
        }

        let arquivoEdital = listaDocumentos.find(arq => {
            const textoObj = JSON.stringify(arq).toLowerCase();
            return (textoObj.includes('edital') || textoObj.includes('termo de refer') || textoObj.includes('termo_de_referencia')) && textoObj.includes('.pdf');
        });

        if (!arquivoEdital) {
            arquivoEdital = listaDocumentos.find(arq => JSON.stringify(arq).toLowerCase().includes('.pdf'));
        }

        if (!arquivoEdital) {
            const docsAchados = listaDocumentos.map(d => d.tituloDocumento || d.nomeArquivo || d.titulo || 'Doc Sem Nome').slice(0, 5).join(', ');
            return `⚠️ O documento do Edital deste pregão não foi encontrado. Anexos disponíveis no sistema: [${docsAchados}]`;
        }

        const linkDownload = arquivoEdital.linkArquivo || arquivoEdital.url || arquivoEdital.linkDownload || arquivoEdital.urlAcesso;

        if (!linkDownload) {
            return `❌ Encontrei o arquivo, mas a API do PNCP não liberou a URL de download para a Hera.`;
        }

        const respostaPdf = await fetch(linkDownload);
        if (!respostaPdf.ok) return `❌ Erro ao tentar fazer o download do PDF do Edital no portal do Governo.`;

        const bufferPdf = await respostaPdf.arrayBuffer();

        const dadosExtraidos = await pdfParse(Buffer.from(bufferPdf));
        const textoCompleto = dadosExtraidos.text;

        const regexTabela = /Rela[cç][aã]o de produtos pr[eé]-qualificados|Relat[oó]rio de Marcas Pr[eé]-Qualificadas/i;
        const indexInicio = textoCompleto.search(regexTabela);

        if (indexInicio === -1) {
            return `📄 O Edital foi lido com sucesso pela Hera via PNCP, mas a seção "Relação de produtos pré-qualificados" não está no documento.`;
        }

        const textoTabela = textoCompleto.substring(indexInicio);
        const linhas = textoTabela.split('\n');

        let extracao = `📄 *Leitura Oficial do Edital PNCP: PE ${numeroLimpo}/${ano}*\n_Tabela de Marcas Pré-Qualificadas extraída!_\n\n`;
        let encontrouItens = false;

        linhas.forEach(linha => {
            const match = linha.match(/(?:^|\s)(\d{1,3})\s+(?:-\s+)?(\d{4,7})(?:\s|$)/);
            if (match) {
                extracao += `*Seq ${match[1]}* - Código: ${match[2]}\n`;
                encontrouItens = true;
            }
        });

        if (!encontrouItens) {
            extracao += `⚠️ Encontrei a página correta no PDF do PNCP, mas a formatação especial impediu a extração exata dos códigos e sequências.`;
        }

        return extracao;
    } catch (erro) {
        console.error('Erro ao ler o Edital via PNCP:', erro);
        return '❌ Ocorreu um erro interno na Hera ao tentar processar as APIs do PNCP.';
    }
}

function formatarData(valor) {
    if (!valor) {
        return 'N/A';
    }

    const data = new Date(valor);

    if (Number.isNaN(data.getTime())) {
        return String(valor);
    }

    return data.toLocaleDateString('pt-BR');
}

function normalizarNumeroContratoExato(valor) {
    return String(valor || '')
        .trim()
        .replace(/[\/\-\s]/g, '')
        .toUpperCase();
}

function numeroContratoExatoEhValido(numero = '') {
    if (/^\d{9}$/.test(numero)) return true;
    if (/^[A-Z0-9]{12}$/.test(numero)) return true;
    return false;
}

function parseFiltrosContrato(termoBusca) {
    const original = String(termoBusca || '').trim();
    let restante = ` ${original} `;

    const filtros = {
        original,
        numeroContrato: '',
        uasg: '',
        orgao: '',
        fornecedor: '',
        textoLivre: ''
    };

    const regexNumeroContrato = /\b(?:contrato\s+)?([0-9]{4}[A-Z]{1,5}[0-9]{3,}|[0-9A-Z./-]{3,}\/[0-9]{4}|[0-9A-Z./-]{6,})\b/i;
    const regexUasg = /\b(?:uasg|unidade gestora|ug)\s+(\d{5,6})\b/i;
    const regexOrgao = /\b[oó]rg[aã]o\s+(.+?)(?=(?:\bfornecedor\b|\buasg\b|\bunidade gestora\b|\bug\b|$))/i;
    const regexFornecedor = /\bfornecedor\s+(.+?)(?=(?:\buasg\b|\bunidade gestora\b|\bug\b|\b[oó]rg[aã]o\b|$))/i;

    const matchUasg = restante.match(regexUasg);
    if (matchUasg) {
        filtros.uasg = String(matchUasg[1] || '').trim();
        restante = restante.replace(matchUasg[0], ' ');
    }

    const matchFornecedor = restante.match(regexFornecedor);
    if (matchFornecedor) {
        filtros.fornecedor = String(matchFornecedor[1] || '').trim();
        restante = restante.replace(matchFornecedor[0], ' ');
    }

    const matchOrgao = restante.match(regexOrgao);
    if (matchOrgao) {
        filtros.orgao = String(matchOrgao[1] || '').trim();
        restante = restante.replace(matchOrgao[0], ' ');
    }

    const matchNumeroContrato = restante.match(regexNumeroContrato);
    if (matchNumeroContrato) {
        filtros.numeroContrato = String(matchNumeroContrato[1] || '').trim();
        restante = restante.replace(matchNumeroContrato[0], ' ');
    }

    filtros.textoLivre = String(restante || '').replace(/\s+/g, ' ').trim();

    return filtros;
}

function extrairPayloadContrato(dados) {
    if (!dados) return null;
    if (Array.isArray(dados)) return dados[0] || null;
    if (dados.data && typeof dados.data === 'object') return extrairPayloadContrato(dados.data);
    if (dados.resultado && typeof dados.resultado === 'object') return extrairPayloadContrato(dados.resultado);
    if (dados.contrato && typeof dados.contrato === 'object') return extrairPayloadContrato(dados.contrato);
    return dados;
}

function formatarContratoExatoApi(dados, numeroConsultado, uasgFixa) {
    const payload = extrairPayloadContrato(dados) || {};

    const contratante = payload?.contratante || {};
    const orgaoOrigem = contratante?.orgao_origem || {};
    const orgaoAtual = contratante?.orgao || {};
    const unidadeOrigem =
        orgaoOrigem?.unidade_gestora_origem ||
        orgaoAtual?.unidade_gestora ||
        {};

    const fornecedor = payload?.fornecedor || {};
    const links = payload?.links || {};

    const numero = payload?.numero || numeroConsultado;
    const id = payload?.id || '-';
    const receitaDespesa = payload?.receita_despesa || '-';
    const tipo = payload?.tipo || '-';
    const subtipo = payload?.subtipo || '-';
    const situacao = payload?.situacao || payload?.status || '-';
    const categoria = payload?.categoria || '-';
    const modalidade = payload?.modalidade || '-';
    const processo = payload?.processo || '-';
    const licitacaoNumero = payload?.licitacao_numero || '-';
    const objeto = payload?.objeto || '-';
    const amparoLegal = payload?.amparo_legal || '-';

    const dataAssinatura = formatarData(payload?.data_assinatura);
    const vigenciaInicio = formatarData(payload?.vigencia_inicio);
    const vigenciaFim = formatarData(payload?.vigencia_fim);

    const valorInicial = formatarMoeda(payload?.valor_inicial);
    const valorGlobal = formatarMoeda(payload?.valor_global);
    const valorParcela = formatarMoeda(payload?.valor_parcela);

    const fornecedorNome = fornecedor?.nome || '-';
    const fornecedorDocumento = fornecedor?.cnpj_cpf_idgener || '-';
    const fornecedorTipo = fornecedor?.tipo || '-';

    const orgaoCodigo = orgaoOrigem?.codigo || orgaoAtual?.codigo || '-';
    const orgaoNome = orgaoOrigem?.nome || orgaoAtual?.nome || '-';

    const ugCodigo = unidadeOrigem?.codigo || payload?.unidade_compra || uasgFixa;
    const ugNomeResumido = unidadeOrigem?.nome_resumido || '-';
    const ugNome = unidadeOrigem?.nome || '-';
    const ugSisg = unidadeOrigem?.sisg || '-';

    let resposta = `📑 *Contrato localizado*\n\n`;
    resposta += `*Número:* ${numero}\n`;
    resposta += `*ID:* ${id}\n`;
    resposta += `*Receita/Despesa:* ${receitaDespesa}\n`;
    resposta += `*Tipo:* ${tipo}\n`;

    if (subtipo !== '-') {
        resposta += `*Subtipo:* ${subtipo}\n`;
    }

    resposta += `*Situação:* ${situacao}\n`;
    resposta += `*Categoria:* ${categoria}\n`;
    resposta += `*Modalidade:* ${modalidade}\n`;
    resposta += `*Licitação:* ${licitacaoNumero}\n`;
    resposta += `*Processo:* ${processo}\n`;
    resposta += `*Amparo legal:* ${amparoLegal}\n`;
    resposta += `*Data da assinatura:* ${dataAssinatura}\n`;
    resposta += `*Vigência:* ${vigenciaInicio} até ${vigenciaFim}\n`;
    resposta += `*Valor inicial:* ${valorInicial}\n`;
    resposta += `*Valor global:* ${valorGlobal}\n`;

    if (valorParcela !== 'N/A') {
        resposta += `*Valor da parcela:* ${valorParcela}\n`;
    }

    resposta += `\n🏢 *Contratante*\n`;
    resposta += `*Órgão:* ${orgaoNome}\n`;
    resposta += `*Código do órgão:* ${orgaoCodigo}\n`;
    resposta += `*UG origem:* ${ugCodigo}\n`;
    resposta += `*UG resumida:* ${ugNomeResumido}\n`;
    resposta += `*UG nome:* ${ugNome}\n`;
    resposta += `*SISG:* ${ugSisg}\n`;

    resposta += `\n🏭 *Fornecedor*\n`;
    resposta += `*Nome:* ${fornecedorNome}\n`;
    resposta += `*Documento:* ${fornecedorDocumento}\n`;
    resposta += `*Tipo:* ${fornecedorTipo}\n`;

    resposta += `\n📝 *Objeto*\n${objeto}\n`;

    if (links?.historico || links?.empenhos || links?.itens || links?.arquivos) {
        resposta += `\n🔗 *Links disponíveis*\n`;
        if (links.historico) resposta += `- Histórico disponível\n`;
        if (links.empenhos) resposta += `- Empenhos disponíveis\n`;
        if (links.itens) resposta += `- Itens disponíveis\n`;
        if (links.arquivos) resposta += `- Arquivos disponíveis\n`;
    }

    return resposta.trim();
}

async function fetchJsonComTimeout(url, {
    accept = 'application/json',
    timeoutMs = 15000,
    headers = {}
} = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resposta = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: accept,
                ...headers
            },
            signal: controller.signal
        });

        const contentType = resposta.headers.get('content-type') || '';
        let dados = null;

        if (contentType.includes('application/json')) {
            dados = await resposta.json().catch(() => null);
        } else {
            const texto = await resposta.text().catch(() => '');
            dados = texto;
        }

        return {
            ok: resposta.ok,
            status: resposta.status,
            data: dados
        };
    } catch (erro) {
        return {
            ok: false,
            status: 0,
            error: erro
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function consultarContratoExatoComprasnet(numeroContratoOriginal) {
    const uasgFixa = '250052';
    const numeroContrato = normalizarNumeroContratoExato(numeroContratoOriginal);

    if (!numeroContratoExatoEhValido(numeroContrato)) {
        return {
            ok: false,
            mensagem:
                '❌ Número de contrato inválido.\n\n' +
                'Envie 9 dígitos sem barra (ex.: 000452023) ' +
                'ou 12 caracteres para empenho com força de contrato (ex.: 2023NE000123).'
        };
    }

    const url = `https://contratos.comprasnet.gov.br/api/contrato/ugorigem/${uasgFixa}/numeroano/${numeroContrato}`;

    const headers = {};
    if (process.env.CONTRATOS_TOKEN) {
        headers.Authorization = `Bearer ${process.env.CONTRATOS_TOKEN}`;
    }

    const resposta = await fetchJsonComTimeout(url, {
        accept: 'application/json',
        timeoutMs: 20000,
        headers
    });

    if (!resposta.ok) {
        if (resposta.status === 401) {
            return {
                ok: false,
                mensagem:
                    '❌ A consulta de contratos retornou erro 401 (autenticação necessária).\n' +
                    'Se o ambiente atual exigir token, configure CONTRATOS_TOKEN.'
            };
        }

        if (resposta.status === 404) {
            return {
                ok: false,
                mensagem: `📭 Não encontrei contrato para o número ${numeroContrato} na UASG ${uasgFixa}.`
            };
        }

        if (resposta.status === 422) {
            const detalhe = resposta?.data?.errors
                ? `\nDetalhe da API: ${JSON.stringify(resposta.data.errors)}`
                : '';

            return {
                ok: false,
                mensagem:
                    '❌ O número informado foi rejeitado pela API de contratos (erro 422).\n' +
                    'Confira se ele foi enviado com 9 dígitos sem barra, ou 12 caracteres no caso de empenho.' +
                    detalhe
            };
        }

        if (resposta.status === 0) {
            return {
                ok: false,
                mensagem: '❌ Não foi possível conectar à API do Comprasnet Contratos no momento.'
            };
        }

        return {
            ok: false,
            mensagem: `❌ Falha ao consultar a API de contratos. Status HTTP: ${resposta.status}.`
        };
    }

    if (!resposta.data || typeof resposta.data !== 'object') {
        return {
            ok: false,
            mensagem: '⚠️ A API respondeu, mas não retornou um JSON de contrato válido.'
        };
    }

    return {
        ok: true,
        mensagem: formatarContratoExatoApi(resposta.data, numeroContrato, uasgFixa)
    };
}

async function consultarContratos(termoBusca) {
    try {
        const filtros = parseFiltrosContrato(termoBusca);

        if (!filtros.original || !filtros.numeroContrato) {
            return (
                '⚠️ Informe o número do contrato.\n\n' +
                'Exemplos:\n' +
                '- *Contrato 000452023*\n' +
                '- *Contrato 2023NE000123*'
            );
        }

        const resultadoExato = await consultarContratoExatoComprasnet(filtros.numeroContrato);
        return resultadoExato.mensagem;
    } catch (erro) {
        console.error('Erro ao consultar contratos:', erro);
        return '❌ Ocorreu um erro ao consultar contratos no Compras.gov.br. Tente novamente mais tarde.';
    }
}

async function gerarRelatorioPregoesAno(ano) {
    await iniciarBancoPregoes();
    const uasg = '250052';
    
    const urlBuscaPNCP = `https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133?unidadeOrgaoCodigoUnidade=${uasg}&codigoModalidade=5&dataPublicacaoPncpInicial=${ano}-01-01&dataPublicacaoPncpFinal=${ano}-12-31&tamanhoPagina=500`;

    try {
        const respostaBusca = await fetch(urlBuscaPNCP, { method: 'GET', headers: { Accept: 'application/json' } });
        if (!respostaBusca.ok) return { erro: `❌ Erro ao consultar o PNCP. Código: ${respostaBusca.status}` };

        const dadosBusca = await respostaBusca.json();
        const contratacoes = dadosBusca.resultado || [];

        if (contratacoes.length === 0) {
            return { erro: `⚠️ Nenhum pregão encontrado para o ano de ${ano}.` };
        }

        let estatisticas = {
            totalPregoes: contratacoes.length,
            totalItensGeral: 0,
            totalHomologados: 0,
            totalDesertos: 0,
            totalFrustrados: 0
        };

        let listaDetalhada = `📋 *Detalhamento dos Pregões de ${ano}*\n\n`;

        for (const pregao of contratacoes) {
            const numeroLimpo = String(pregao.numeroCompra);
            const idCompra = pregao.idCompra;
            const situacaoGeral = pregao.situacaoCompraNomePncp || 'N/A';

            const cache = await buscarPregaoCache(idCompra);
            
            let dadosPregao = {
                idCompra, numeroLimpo, ano, situacaoGeral,
                totalItens: 0, homologados: 0, desertos: 0, frustrados: 0, concluido: false
            };

            if (cache && cache.concluido === 1) {
                dadosPregao.totalItens = cache.total_itens;
                dadosPregao.homologados = cache.homologados;
                dadosPregao.desertos = cache.desertos;
                dadosPregao.frustrados = cache.frustrados;
                dadosPregao.concluido = true;
            } else {
                try {
                    await esperar(500); 
                    const itensBrutos = await buscarTodosItensDaCompra(idCompra);
                    dadosPregao.totalItens = itensBrutos.length;

                    itensBrutos.forEach(item => {
                        const sit = String(item.situacaoCompraItemNome || item.situacaoItem || '').toLowerCase();
                        if (sit.includes('homologado')) dadosPregao.homologados++;
                        else if (sit.includes('deserto')) dadosPregao.desertos++;
                        else if (sit.includes('fracassado') || sit.includes('cancelado') || sit.includes('anulado')) dadosPregao.frustrados++;
                    });

                    const totalEncerrados = dadosPregao.homologados + dadosPregao.desertos + dadosPregao.frustrados;
                    if (dadosPregao.totalItens > 0 && totalEncerrados === dadosPregao.totalItens) {
                        dadosPregao.concluido = true;
                    }

                    await salvarPregaoCache(dadosPregao);

                } catch (e) {
                    console.log(`Erro ao buscar itens do pregão ${numeroLimpo}:`, e.message);
                }
            }

            estatisticas.totalItensGeral += dadosPregao.totalItens;
            estatisticas.totalHomologados += dadosPregao.homologados;
            estatisticas.totalDesertos += dadosPregao.desertos;
            estatisticas.totalFrustrados += dadosPregao.frustrados;

            const objetoPregao = String(pregao.objetoCompra || pregao.objeto || '');
            const matchSEI = objetoPregao.match(/25410\.\d{6}\/\d{4}-\d{2}/);
            const processoSEI = matchSEI ? matchSEI[0] : 'Não identificado';

            listaDetalhada += `*PE ${numeroLimpo}/${ano}* - ${dadosPregao.totalItens} itens (${situacaoGeral})\n`;
            listaDetalhada += `↳ ✅ ${dadosPregao.homologados} | ⚠️ ${dadosPregao.frustrados} | ❌ ${dadosPregao.desertos}\n`;
            listaDetalhada += `SEI nº ${processoSEI}\n\n`;
        }

        const calcPerc = (valor) => estatisticas.totalItensGeral > 0 ? ((valor / estatisticas.totalItensGeral) * 100).toFixed(1) : 0;

        let mensagemResumo = `📊 *Relatório Anual de Pregões (${ano})*\n\n`;
        mensagemResumo += `*Total de Pregões realizados:* ${estatisticas.totalPregoes}\n`;
        mensagemResumo += `*Total de Itens processados:* ${estatisticas.totalItensGeral}\n\n`;
        mensagemResumo += `📈 *Desempenho de Homologação:*\n`;
        mensagemResumo += `✅ *Homologados:* *${calcPerc(estatisticas.totalHomologados)}%* (${estatisticas.totalHomologados} itens)\n`;
        mensagemResumo += `⚠️ *Desertos:* *${calcPerc(estatisticas.totalDesertos)}%* (${estatisticas.totalDesertos} itens)\n`;
        mensagemResumo += `❌ *Frustrados/Cancelados:* *${calcPerc(estatisticas.totalFrustrados)}%* (${estatisticas.totalFrustrados} itens)\n\n`;
        mensagemResumo += `_Dica: Se quiser detalhes de um pregão específico, digite "PE numero/${ano}"._`;

        return {
            sucesso: true,
            mensagemResumo,
            mensagemLista: listaDetalhada.trim()
        };

    } catch (erro) {
        console.error('Erro na varredura anual:', erro);
        return { erro: '❌ Ocorreu um erro ao processar o relatório anual de pregões. Tente novamente mais tarde.' };
    }
}

module.exports = {
    consultarEmpenhoARP,
    consultarItensPregao,
    lerEditalPregao,
    consultarContratos,
    gerarRelatorioPregoesAno,
	buscarTodosItensDaCompra
};