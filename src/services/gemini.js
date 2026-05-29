const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const { buscarItem, contarItensGrade } = require('./excel');
const { consultarItensPregao, lerEditalPregao } = require('./api');
const { salvarPerfil, buscarPerfil } = require('./memoria');
const { consultarCodigoSidecMaterial, extrairCodigoSidecDaMensagem } = require('./sidec');

const groqAI = new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY
});

const openRouterAI = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPEN_ROUTER_API_KEY
});

const openaiAI = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const deepseekAI = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY
});

const geminiAI = new OpenAI({
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: process.env.GEMINI_API_KEY
});

const MENSAGEM_SEM_AUTORIZACAO_CONSULTA =
    'Você não pode fazer essa consulta pois seu número não está salvo, enviei para o Flavio verificar e te dar um retorno.';

function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function normalizarTextoMinusculo(texto) {
    return normalizarTexto(texto).toLowerCase();
}

function normalizarRespostaDeTexto(texto) {
    return String(texto || '').trim();
}

function garantirTextoUtil(texto, mensagemPadrao) {
    const textoNormalizado = normalizarRespostaDeTexto(texto);
    return textoNormalizado || mensagemPadrao;
}

function textoPareceCodigoDeItem(texto) {
    const textoLimpo = String(texto || '').trim().toUpperCase();
    return /^[A-Z]?\d{3,10}$/.test(textoLimpo);
}

function extrairPossiveisCodigos(texto) {
    const encontrados = String(texto || '')
        .toUpperCase()
        .match(/\b[A-Z]?\d{3,10}\b/g);
    return encontrados || [];
}

function textoEhPedidoDeContagem(texto) {
    const textoNormalizado = normalizarTextoMinusculo(texto);
    return (
        textoNormalizado.includes('quantos itens tem na grade') ||
        textoNormalizado.includes('quantos itens ha na grade') ||
        textoNormalizado.includes('qual o tamanho da grade') ||
        textoNormalizado.includes('contar os itens') ||
        textoNormalizado.includes('conte os itens da grade') ||
        textoNormalizado.includes('quantidade de itens da grade')
    );
}

function textoEhPedidoDeListagemPregoes(texto) {
    const textoNormalizado = normalizarTextoMinusculo(texto);
    return (
        textoNormalizado.includes('quais sao os pregoes ativos') ||
        textoNormalizado.includes('quais s o os pregoes ativos') ||
        textoNormalizado.includes('quais sao os preg es ativos') ||
        textoNormalizado.includes('quais s o os preg es ativos') ||
        textoNormalizado.includes('listar pregoes') ||
        textoNormalizado.includes('listar preg es')
    );
}

function extrairNumeroPregao(texto) {
    const textoOriginal = String(texto || '').trim();
    const textoNormalizado = normalizarTextoMinusculo(textoOriginal);

    const matchFormatoCompleto = textoOriginal.match(/(\d{1,6})\s*\/\s*(\d{4})/);
    if (matchFormatoCompleto) {
        return `${matchFormatoCompleto[1]}/${matchFormatoCompleto[2]}`;
    }

    const matchComPe = textoNormalizado.match(/pe\s*(\d{1,6})[.\- ]?(\d{4})/i);
    if (matchComPe) {
        return `${matchComPe[1]}/${matchComPe[2]}`;
    }

    const matchPregao = textoNormalizado.match(/preg[a ã]o\s*(\d{1,6})[.\- ]?(\d{4})/i);
    if (matchPregao) {
        return `${matchPregao[1]}/${matchPregao[2]}`;
    }

    return null;
}

function textoEhPedidoDeEdital(texto) {
    const textoNormalizado = normalizarTextoMinusculo(texto);
    return (
        textoNormalizado.includes('ler edital') ||
        textoNormalizado.includes('leia o edital') ||
        textoNormalizado.includes('mostrar edital') ||
        textoNormalizado.includes('mostrar o edital') ||
        textoNormalizado.includes('baixar edital') ||
        textoNormalizado.includes('consultar edital')
    );
}

function textoEhProcessoSei(texto) {
    const textoLimpo = String(texto || '').trim();
    return /^\d{5}\.\d{6}\/\d{4}-\d{2}$/.test(textoLimpo);
}

function textoEhAssuntoDeContratoOuRh(texto, nomeEmpresaAtual) {
    const textoNormalizado = normalizarTextoMinusculo(texto);
    const nomeEmpresaNormalizado = normalizarTextoMinusculo(nomeEmpresaAtual);

    const palavrasChave = [
        'ferias', 'férias', 'ponto', 'ponto de almoco', 'ponto de almoço',
        'almoco', 'almoço', 'teletrabalho', 'home office', 'holerite',
        'contrato', 'rh', 'recursos humanos', 'folha', 'beneficio',
        'benefício', 'vale transporte', 'vale alimentacao', 'vale alimentação',
        'atestado', 'escala', 'jornada', 'hora extra'
    ];

    if (nomeEmpresaNormalizado && textoNormalizado.includes(nomeEmpresaNormalizado)) {
        return true;
    }

    return palavrasChave.some(palavra => textoNormalizado.includes(normalizarTextoMinusculo(palavra)));
}

function textoEhConsultaDeItem(texto) {
    const textoNormalizado = normalizarTextoMinusculo(texto);
    const gatilhos = [
        'item ', 'codigo da', 'código da', 'codigo do', 'código do',
        'busque para mim', 'busca para mim', 'procure para mim',
        'procure o item', 'buscar item', 'buscar o item',
        'me fala o codigo', 'me fala o código', 'qual o codigo',
        'qual o código', 'qual e o codigo', 'qual é o código',
        'qual e o item', 'qual é o item', 'dipirona', 'paracetamol',
        'amoxicilina', 'seringa', 'luva', 'agulha'
    ];
    return gatilhos.some(gatilho => textoNormalizado.includes(gatilho));
}

function extrairTermoDeBuscaDeItem(texto) {
    const textoOriginal = String(texto || '').trim();
    const textoNormalizado = normalizarTextoMinusculo(textoOriginal);
    const codigos = extrairPossiveisCodigos(textoOriginal);

    if (codigos.length > 0) {
        return codigos[0];
    }

    const padroes = [
        /qual o codigo da (.+)/i, /qual o código da (.+)/i,
        /qual o codigo do (.+)/i, /qual o código do (.+)/i,
        /busque para mim o item (.+)/i, /busque para mim (.+)/i,
        /procure para mim o item (.+)/i, /procure para mim (.+)/i,
        /buscar o item (.+)/i, /buscar item (.+)/i,
        /me fala o codigo da (.+)/i, /me fala o código da (.+)/i,
        /me fala o codigo do (.+)/i, /me fala o código do (.+)/i
    ];

    for (const padrao of padroes) {
        const match = textoOriginal.match(padrao);
        if (match && match[1]) {
            return String(match[1]).trim();
        }
    }

    if (textoNormalizado.startsWith('item ')) {
        return textoOriginal.substring(5).trim();
    }

    return textoOriginal;
}

function textoEhPerguntaDeDataHora(texto) {
    const t = normalizarTextoMinusculo(texto);
    return (
        t.includes('que horas sao') || t.includes('que horas são') ||
        t.includes('que dia e hoje') || t.includes('que dia é hoje') ||
        t.includes('qual dia e hoje') || t.includes('qual dia é hoje') ||
        t.includes('qual a data de hoje') || t.includes('qual é a data de hoje') ||
        t.includes('que horas sao e que dia e hoje') || t.includes('que horas são e que dia é hoje')
    );
}

function textoEhPerguntaDeDDD(texto) {
    const t = normalizarTextoMinusculo(texto);
    return (
        t.includes('ddd') &&
        (
            t.includes('qual estado') || t.includes('de que estado') ||
            t.includes('pertence a onde') || t.includes('é de onde') ||
            t.includes('é de qual estado')
        )
    );
}

function textoEhComandoEspecial(texto, nomeEmpresaAtual = 'CNS') {
    return (
        textoEhPerguntaDeDataHora(texto) ||
        textoEhPerguntaDeDDD(texto) ||
        textoEhPedidoDeContagem(texto) ||
        textoEhPedidoDeListagemPregoes(texto) ||
        textoEhPedidoDeEdital(texto) ||
        textoEhProcessoSei(texto) ||
        textoEhConsultaDeItem(texto) ||
        textoPareceCodigoDeItem(texto) ||
        Boolean(extrairNumeroPregao(texto)) ||
        Boolean(extrairCodigoSidecDaMensagem(texto)) ||
        textoEhAssuntoDeContratoOuRh(texto, nomeEmpresaAtual)
    );
}

function prefixarRespostaComoHera(texto) {
    const textoFinal = String(texto || '').trim();
    if (!textoFinal) return textoFinal;
    if (textoFinal.startsWith('🤖 Hera:') || textoFinal.startsWith('🤖 Hera, assistente virtual do Flávio:')) {
        return textoFinal;
    }
    return `🤖 Hera, assistente virtual do Flávio:\n\n${textoFinal}`;
}

function agoraBrasil() {
    return new Date();
}

function formatarDataHoraAtual() {
    const agora = agoraBrasil();
    const diasSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    const diaSemana = diasSemana[agora.getDay()];
    const data = agora.toLocaleDateString('pt-BR');
    const hora = agora.toLocaleTimeString('pt-BR');

    return {
        diaSemana, data, hora,
        texto: `Agora são ${hora} e hoje é ${diaSemana}, ${data}.`
    };
}

const mapaDDD = {
    '11': 'São Paulo', '12': 'São Paulo', '13': 'São Paulo', '14': 'São Paulo', '15': 'São Paulo',
    '16': 'São Paulo', '17': 'São Paulo', '18': 'São Paulo', '19': 'São Paulo', '21': 'Rio de Janeiro',
    '22': 'Rio de Janeiro', '24': 'Rio de Janeiro', '27': 'Espírito Santo', '28': 'Espírito Santo',
    '31': 'Minas Gerais', '32': 'Minas Gerais', '33': 'Minas Gerais', '34': 'Minas Gerais', '35': 'Minas Gerais',
    '37': 'Minas Gerais', '38': 'Minas Gerais', '41': 'Paraná', '42': 'Paraná', '43': 'Paraná',
    '44': 'Paraná', '45': 'Paraná', '46': 'Paraná', '47': 'Santa Catarina', '48': 'Santa Catarina',
    '49': 'Santa Catarina', '51': 'Rio Grande do Sul', '53': 'Rio Grande do Sul', '54': 'Rio Grande do Sul',
    '55': 'Rio Grande do Sul', '61': 'Distrito Federal', '62': 'Goiás', '64': 'Goiás', '63': 'Tocantins',
    '65': 'Mato Grosso', '66': 'Mato Grosso', '67': 'Mato Grosso do Sul', '68': 'Acre', '69': 'Rondônia',
    '71': 'Bahia', '73': 'Bahia', '74': 'Bahia', '75': 'Bahia', '77': 'Bahia', '79': 'Sergipe',
    '81': 'Pernambuco', '82': 'Alagoas', '83': 'Paraíba', '84': 'Rio Grande do Norte', '85': 'Ceará',
    '86': 'Piauí', '87': 'Pernambuco', '88': 'Ceará', '89': 'Piauí', '91': 'Pará', '92': 'Amazonas',
    '93': 'Pará', '94': 'Pará', '95': 'Roraima', '96': 'Amapá', '97': 'Amazonas', '98': 'Maranhão', '99': 'Maranhão'
};

function extrairDDD(texto) {
    const match = String(texto || '').match(/\b(\d{2})\b/);
    return match ? match[1] : null;
}

function responderDDD(texto) {
    const ddd = extrairDDD(texto);
    if (!ddd) return null;
    const estado = mapaDDD[ddd];
    if (!estado) return `Eu não encontrei o DDD ${ddd} na minha base local.`;
    return `O DDD ${ddd} pertence ao estado do ${estado}.`;
}

async function gerarTextoComOllamaLocal(mensagens, temperatura = 0.3) {
    const ollamaAtivo = String(process.env.OLLAMA_ATIVO || 'false').toLowerCase() === 'true';
    if (!ollamaAtivo) throw new Error('Ollama local está desativado no arquivo de ambiente.');

    const urlBaseDoOllama = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    const modeloDoOllama = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

    const resposta = await fetch(`${urlBaseDoOllama}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: modeloDoOllama,
            messages: mensagens,
            stream: false,
            options: { temperature: temperatura }
        })
    });

    if (!resposta.ok) {
        const textoDoErro = await resposta.text();
        throw new Error(`Erro HTTP no Ollama: ${resposta.status} - ${textoDoErro}`);
    }

    const dados = await resposta.json();
    if (!dados || !dados.message || !dados.message.content) {
        throw new Error('Resposta inválida retornada pelo Ollama.');
    }

    const textoFinal = normalizarRespostaDeTexto(dados.message.content);
    if (!textoFinal) throw new Error('O Ollama retornou conteúdo vazio.');

    return textoFinal;
}

async function gerarTextoComFallback(mensagens, temperatura = 0.3) {
    try {
        const resposta = await groqAI.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: mensagens,
            temperature: temperatura
        });
        const texto = normalizarRespostaDeTexto(resposta?.choices?.[0]?.message?.content);
        if (!texto) throw new Error('Groq retornou resposta vazia.');
        return texto;
    } catch (erroGroq) {
        console.log('🔄 Groq falhou. Acionando OpenRouter...', erroGroq.message);
        try {
            const resposta = await openRouterAI.chat.completions.create({
                model: 'meta-llama/llama-3.1-8b-instruct',
                messages: mensagens,
                temperature: temperatura
            });
            const texto = normalizarRespostaDeTexto(resposta?.choices?.[0]?.message?.content);
            if (!texto) throw new Error('OpenRouter retornou resposta vazia.');
            return texto;
        } catch (erroOpenRouter) {
            console.log('🔄 OpenRouter falhou. Acionando OpenAI...', erroOpenRouter.message);
            try {
                const resposta = await openaiAI.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: mensagens,
                    temperature: temperatura
                });
                const texto = normalizarRespostaDeTexto(resposta?.choices?.[0]?.message?.content);
                if (!texto) throw new Error('OpenAI retornou resposta vazia.');
                return texto;
            } catch (erroOpenAI) {
                console.log('🔄 OpenAI falhou. Acionando DeepSeek...', erroOpenAI.message);
                try {
                    const resposta = await deepseekAI.chat.completions.create({
                        model: 'deepseek-chat',
                        messages: mensagens,
                        temperature: temperatura
                    });
                    const texto = normalizarRespostaDeTexto(resposta?.choices?.[0]?.message?.content);
                    if (!texto) throw new Error('DeepSeek retornou resposta vazia.');
                    return texto;
                } catch (erroDeepSeek) {
                    console.log('🔄 DeepSeek falhou. Acionando Gemini...', erroDeepSeek.message);
                    try {
                        const resposta = await geminiAI.chat.completions.create({
                            model: 'gemini-1.5-flash',
                            messages: mensagens,
                            temperature: temperatura
                        });
                        const texto = normalizarRespostaDeTexto(resposta?.choices?.[0]?.message?.content);
                        if (!texto) throw new Error('Gemini retornou resposta vazia.');
                        return texto;
                    } catch (erroGemini) {
                        console.log('🔄 Gemini falhou. Acionando Ollama local...', erroGemini.message);
                        try {
                            return await gerarTextoComOllamaLocal(mensagens, temperatura);
                        } catch (erroOllama) {
                            console.error('❌ Todas as inteligências artificiais falharam.', erroOllama.message);
                            return 'Sistema temporariamente indisponível devido a instabilidade dos provedores.';
                        }
                    }
                }
            }
        }
    }
}

async function lerRegrasContrato() {
    const caminhoDiretorio = path.join(process.cwd(), 'data', 'contrato');
    let textoTotal = '';
    if (!fs.existsSync(caminhoDiretorio)) {
        fs.mkdirSync(caminhoDiretorio, { recursive: true });
        return '';
    }
    const arquivos = fs.readdirSync(caminhoDiretorio);
    let encontrouArquivoTexto = false;

    for (const arquivo of arquivos) {
        if (arquivo.toLowerCase().endsWith('.txt')) {
            encontrouArquivoTexto = true;
            try {
                const conteudo = fs.readFileSync(path.join(caminhoDiretorio, arquivo), 'utf-8');
                textoTotal += `\n--- [REGRA: ${arquivo}] ---\n${conteudo}\n`;
            } catch (erro) {
                console.error(`Erro ao ler o arquivo ${arquivo}:`, erro);
            }
        }
    }
    return encontrouArquivoTexto ? textoTotal : '';
}

function dividirEmBlocos(texto, tamanho = 1800) {
    const textoLimpo = String(texto || '').trim();
    if (!textoLimpo) return [];
    const blocos = [];
    for (let i = 0; i < textoLimpo.length; i += tamanho) {
        blocos.push(textoLimpo.slice(i, i + tamanho));
    }
    return blocos;
}

function pontuarTrecho(pergunta, trecho) {
    const palavrasPergunta = normalizarTextoMinusculo(pergunta).split(/\s+/).filter(p => p.length > 2);
    const trechoNormalizado = normalizarTextoMinusculo(trecho);
    let score = 0;
    palavrasPergunta.forEach(palavra => {
        if (trechoNormalizado.includes(palavra)) score += 1;
    });

    const t = normalizarTextoMinusculo(pergunta);
    if (t.includes('teletrabalho') && trechoNormalizado.includes('teletrabalho')) score += 5;
    if ((t.includes('almoco') || t.includes('almoço')) && trechoNormalizado.includes('almoco')) score += 5;
    if ((t.includes('ponto') || t.includes('registrar')) && trechoNormalizado.includes('ponto')) score += 5;
    if (t.includes('rhid') && trechoNormalizado.includes('rhid')) score += 5;

    return score;
}

async function buscarTrechosRelevantesContrato(pergunta) {
    const caminhoDiretorio = path.join(process.cwd(), 'data', 'contrato');
    if (!fs.existsSync(caminhoDiretorio)) return [];

    const arquivos = fs.readdirSync(caminhoDiretorio).filter(a => a.toLowerCase().endsWith('.txt'));
    const resultados = [];

    for (const arquivo of arquivos) {
        try {
            const conteudo = fs.readFileSync(path.join(caminhoDiretorio, arquivo), 'utf-8');
            const blocos = dividirEmBlocos(conteudo, 2000);
            blocos.forEach((bloco, index) => {
                const score = pontuarTrecho(pergunta, bloco);
                if (score > 0) {
                    resultados.push({ arquivo, index, score, trecho: bloco });
                }
            });
        } catch (erro) {
            console.error(`Erro ao analisar trechos do arquivo ${arquivo}:`, erro);
        }
    }
    return resultados.sort((a, b) => b.score - a.score).slice(0, 5);
}

async function transcreverAudio(mediaBase64, mimeType) {
    try {
        const audioBuffer = Buffer.from(mediaBase64, 'base64');
        const arquivo = await OpenAI.toFile(audioBuffer, 'audio.ogg');
        const transcricao = await groqAI.audio.transcriptions.create({
            file: arquivo,
            model: 'whisper-large-v3',
            response_format: 'text',
            language: 'pt'
        });
        return garantirTextoUtil(
            transcricao,
            'Não consegui transcrever o áudio com conteúdo útil.'
        );
    } catch (erro) {
        console.error('Erro ao transcrever o áudio:', erro);
        return 'Não consegui transcrever o áudio no momento. Por favor, envie sua solicitação por texto.';
    }
}

async function analisarPerfilContato(historico, telefone, nomeContato) {
    try {
        const promptAnalise = `Você é um analista comportamental de inteligência artificial. 
Leia o histórico recente de mensagens de WhatsApp abaixo entre o Flávio e o contato "${nomeContato}". 

HISTÓRICO DA CONVERSA: 
${historico} 

Sua tarefa: 
1. Identificar o grau de intimidade e o tom da conversa. 
2. Definir quem é essa pessoa em relação ao Flávio. 
3. Definir um "tomDeVoz" com adjetivos que uma assistente virtual deve usar ao responder essa pessoa. 

Retorne APENAS um JSON válido, sem markdown e sem blocos de código ( \`\`\`json ), no formato exato abaixo:
{
    "relacionamento": "descrição do vínculo",
    "tomDeVoz": "lista de adjetivos"
}`;

        let respostaBruta = await gerarTextoComFallback(
            [{ role: 'user', content: promptAnalise }],
            0.1
        );

        respostaBruta = respostaBruta.replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();

        const perfilCriado = JSON.parse(respostaBruta);

        await salvarPerfil(
            telefone,
            nomeContato || 'Contato',
            perfilCriado.relacionamento,
            perfilCriado.tomDeVoz
        );

        return "✅ Perfil criado ou atualizado com sucesso.\n\n👁️ Visão da Hera:\n- Status: " + perfilCriado.relacionamento + "\n- Como vou tratar esta pessoa: " + perfilCriado.tomDeVoz;
    } catch (erro) {
        console.error('Erro ao analisar perfil:', erro);
        return 'Não consegui analisar o histórico deste contato.';
    }
}

async function consolidarMemoriaDeContato(telefone, nomeContato, resumoAntigo, mensagensDoDia) {
    try {
        const historicoTexto = mensagensDoDia
            .map(m => `${m.role === 'user' ? nomeContato : 'Hera'}: ${m.content}`)
            .join('\n');

        const prompt = `Você é o subsistema de memória de longo prazo da Hera, assistente virtual do Flávio.
Sua tarefa é analisar as conversas de hoje deste contato e atualizar a ficha pessoal dele.

RESUMO ATUAL SOBRE O CONTATO: 
${resumoAntigo || 'Nenhuma informação prévia.'}

CONVERSAS DE HOJE:
${historicoTexto}

INSTRUÇÕES:
1. Mantenha os fatos importantes do "Resumo Atual" intactos.
2. Extraia novos fatos relevantes das "Conversas de Hoje" (ex: cargo, projeto atual, preferências, nomes de pets/parentes, onde mora, etc) e adicione à ficha.
3. Ignore bate-papo inútil (ex: "bom dia", "ok", "obrigado").
4. Escreva um parágrafo contínuo, conciso e objetivo descrevendo o contato. 
5. NÃO use marcadores ou introduções. Retorne APENAS o novo texto da ficha consolidada.`;

        const novoResumo = await gerarTextoComFallback([{ role: 'user', content: prompt }], 0.2);
        return garantirTextoUtil(novoResumo, resumoAntigo);
    } catch (erro) {
        console.error(`Erro ao consolidar memória via IA para o contato ${telefone}:`, erro);
        return resumoAntigo; 
    }
}

function obterTipoDeContato(contato) {
    const nomeDoContato = String(contato.name || '').trim().toUpperCase();
    const contatoEstaSalvo = Boolean(contato.isSaved);

    if (nomeDoContato.includes('INCA')) return 'TRABALHO';
    if (contatoEstaSalvo) return 'PESSOAL';
    return 'DESCONHECIDO';
}

function montarSaudacaoDeApresentacao(tipoDeContato) {
    if (tipoDeContato === 'TRABALHO') {
        return 'Olá! Eu me chamo Hera e sou a assistente do Flávio. No momento ele está ocupado, mas verá sua mensagem assim que possível. Se você quiser consultar o status de um pregão, pode me enviar no formato PE xxxxx/xxxx. Se quiser consultar um item, pode me enviar o código do item.';
    }
    if (tipoDeContato === 'PESSOAL') {
        return 'Olá! Eu me chamo Hera e sou a assistente virtual do Flávio. No momento ele está ocupado, mas verá sua mensagem assim que possível. Se você quiser, pode me dizer sobre o que deseja falar com ele.';
    }
    return 'Olá! Eu me chamo Hera e sou a assistente virtual do Flávio. No momento ele não pode responder. Se puder, por favor se apresente, diga qual é o assunto e deixe sua mensagem para que ele veja quando retornar.';
}

function obterSaudacaoPorHorario() {
    const horaAtual = new Date().getHours();
    if (horaAtual >= 5 && horaAtual < 12) return 'Bom dia';
    if (horaAtual >= 12 && horaAtual < 18) return 'Boa tarde';
    return 'Boa noite';
}

function mensagemPareceSaudacaoSimples(textoUsuario) {
    const textoNormalizado = String(textoUsuario || '').trim().toLowerCase();
    const saudacoesSimples = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'e ai', 'e aí', 'opa', 'oii', 'oiii', 'hello'];
    return saudacoesSimples.includes(textoNormalizado);
}

async function processarTextoComIA(textoUsuario, contato, historicoRecente = [], precisaApresentar = false) {
    try {
        const dataHoraAtual = new Date().toLocaleString('pt-BR');
        const tipoDeContato = obterTipoDeContato(contato);
        const saudacaoDoHorario = obterSaudacaoPorHorario();

        let nomeEmpresaAtual = 'CNS';
        const caminhoArquivoConfiguracao = path.join(process.cwd(), 'data', 'config.json');
        if (fs.existsSync(caminhoArquivoConfiguracao)) {
            try {
                const configuracao = JSON.parse(fs.readFileSync(caminhoArquivoConfiguracao, 'utf-8'));
                if (configuracao.empresa) nomeEmpresaAtual = configuracao.empresa;
            } catch (erro) {
                console.log('Não foi possível ler o arquivo de configuração. Seguindo com valor padrão.');
            }
        }

        const ehComandoEspecial = textoEhComandoEspecial(textoUsuario, nomeEmpresaAtual);
        let contatoTemPerfilSalvo = false;
        let contextoDeRelacionamento = '';
        let tomDeVozDoContato = '';

        const perfilDoBanco = await buscarPerfil(contato.telefone);
        if (perfilDoBanco) {
            contatoTemPerfilSalvo = true;
            contextoDeRelacionamento = perfilDoBanco.resumo_perfil || '';
            tomDeVozDoContato = perfilDoBanco.tom_de_voz || '';
        }

        const historicoFormatado = historicoRecente
            .map(item => {
                const nomeExibicaoContato = contato.name || 'Contato';
                const autor = item.role === 'user' ? nomeExibicaoContato : 'Hera';
                return `${autor}: ${item.content}`;
            })
            .join('\n');

        let respostaFinal = '';
        let termoBuscadoFinal = '';

        if (textoEhPerguntaDeDataHora(textoUsuario)) {
            respostaFinal = formatarDataHoraAtual().texto;
            termoBuscadoFinal = 'Data e hora atual';
        }

        if (!respostaFinal && textoEhPerguntaDeDDD(textoUsuario)) {
            respostaFinal = responderDDD(textoUsuario);
            termoBuscadoFinal = 'Consulta de DDD';
        }

        if (!respostaFinal) {
            const codigoSidecDetectado = extrairCodigoSidecDaMensagem(textoUsuario);
            if (codigoSidecDetectado) {
                const resultadoSidec = await consultarCodigoSidecMaterial(codigoSidecDetectado);
                respostaFinal = resultadoSidec.mensagem || `Não achei dados no SIDEC para o código ${codigoSidecDetectado}.`;
                termoBuscadoFinal = `SIDEC ${codigoSidecDetectado}`;
            }
        }

        if (!respostaFinal && tipoDeContato === 'TRABALHO') {
            if (textoEhPedidoDeContagem(textoUsuario)) {
                respostaFinal = `${MENSAGEM_SEM_AUTORIZACAO_CONSULTA}`;
                termoBuscadoFinal = 'Consulta negada - contagem da grade';
            } else if (textoEhProcessoSei(textoUsuario)) {
                respostaFinal = 'Eu identifiquei que esta mensagem parece ser um número de processo SEI. No momento eu consigo ajudar melhor com consultas de pregões, atas, SIDEC e itens.';
                termoBuscadoFinal = 'Processo SEI';
            } else if (textoEhPedidoDeEdital(textoUsuario)) {
                const numeroPregao = extrairNumeroPregao(textoUsuario);
                if (numeroPregao) {
                    const resultadoEdital = await lerEditalPregao(numeroPregao);
                    respostaFinal = resultadoEdital || `Não consegui ler ou encontrar o edital do pregão ${numeroPregao}.`;
                    termoBuscadoFinal = `Leitura de edital ${numeroPregao}`;
                }
            } else if (extrairNumeroPregao(textoUsuario)) {
                const numeroPregao = extrairNumeroPregao(textoUsuario);
                const resultadoPregao = await consultarItensPregao(numeroPregao);
                respostaFinal = resultadoPregao || `Eu busquei aqui, mas não achei dados do pregão ${numeroPregao} no sistema.`;
                termoBuscadoFinal = `Pregão ${numeroPregao}`;
            } else if (textoEhPedidoDeListagemPregoes(textoUsuario)) {
                respostaFinal = 'No momento eu consigo consultar melhor um pregão específico, desde que você me envie o número dele.';
                termoBuscadoFinal = 'Listagem de pregões';
            } else if (textoEhAssuntoDeContratoOuRh(textoUsuario, nomeEmpresaAtual)) {
                const trechosRelevantes = await buscarTrechosRelevantesContrato(textoUsuario);
                if (!trechosRelevantes.length) {
                    respostaFinal = `Eu não encontrei essa informação de forma clara nos documentos da ${nomeEmpresaAtual}.`;
                    termoBuscadoFinal = `Dúvidas sobre ${nomeEmpresaAtual}`;
                } else {
                    const contextoTrechos = trechosRelevantes
                        .map((item, i) => `### TRECHO ${i + 1} - ${item.arquivo}\n${item.trecho}`)
                        .join('\n\n');

                    const promptDeContrato = `Você é a Hera, assistente virtual do Flávio.
                    
PERGUNTA DO USUÁRIO: "${textoUsuario}"

RESPONDA USANDO SOMENTE OS TRECHOS ABAIXO:
${contextoTrechos}

REGRAS:
1. NÃO INVENTE NADA. Responda estritamente com base nos trechos acima.
2. Responda de forma objetiva, natural e na primeira pessoa.
3. Se a informação não estiver exatamente nos trechos, diga: "Eu não encontrei essa informação de forma clara nos documentos da ${nomeEmpresaAtual}." e NÃO tente adivinhar.`;

                    respostaFinal = await gerarTextoComFallback([{ role: 'user', content: promptDeContrato }], 0.1);
                    respostaFinal = garantirTextoUtil(respostaFinal, `Eu não encontrei essa informação de forma clara nos documentos da ${nomeEmpresaAtual}.`);
                    termoBuscadoFinal = `Dúvidas sobre ${nomeEmpresaAtual}`;
                }
            } else if (textoEhConsultaDeItem(textoUsuario) || textoPareceCodigoDeItem(textoUsuario)) {
                respostaFinal = MENSAGEM_SEM_AUTORIZACAO_CONSULTA;
                termoBuscadoFinal = 'Consulta negada - item/estoque/grade';
            }
        }

        if (!respostaFinal) {
            let contextoDoContato = '';
            if (tipoDeContato === 'TRABALHO') {
                contextoDoContato = contatoTemPerfilSalvo
                    ? `Contato de trabalho: ${contato.name}. Relação: ${contextoDeRelacionamento}. Tom ideal: ${tomDeVozDoContato}.`
                    : `Contato de trabalho: ${contato.name}. Responda com clareza e educação.`;
                termoBuscadoFinal = termoBuscadoFinal || 'Bate-papo trabalho';
            } else if (tipoDeContato === 'PESSOAL') {
                contextoDoContato = contatoTemPerfilSalvo
                    ? `Contato pessoal salvo: ${contato.name}. Relação: ${contextoDeRelacionamento}. Tom ideal: ${tomDeVozDoContato}.`
                    : `Contato pessoal salvo: ${contato.name}. Responda de forma natural e próxima.`;
                termoBuscadoFinal = termoBuscadoFinal || `Contato pessoal ${contato.name || ''}`.trim();
            } else {
                contextoDoContato = `Contato desconhecido/não salvo. Responda com educação e objetividade.`;
                termoBuscadoFinal = termoBuscadoFinal || 'Contato desconhecido';
            }

            const promptDeConversa = `Você é a Hera, assistente virtual do Flávio.

CONTEXTO:
- Seu criador/chefe: Flávio (Ramal dele: 5747).
- Você está falando com: ${contato.name || 'Contato'}.
- Tipo de contato: ${contextoDoContato}
- Data e hora atual: ${dataHoraAtual}

DIRETRIZES DE COMPORTAMENTO (SIGA À RISCA):
1. IDENTIDADE: Fale sempre na primeira pessoa como Hera. NUNCA finja ser o Flávio.
2. CONCISÃO EXTREMA: Seja direta, humana e informal. Responda em 1 ou 2 frases curtas. Pareça uma pessoa normal no WhatsApp. Nada de textões corporativos.
3. ANTI-ALUCINAÇÃO (O MAIS IMPORTANTE): Se o usuário fizer uma pergunta e a resposta não estiver clara no histórico ou no seu conhecimento imediato, NÃO INVENTE. Responda APENAS: "Não tenho certeza sobre isso, vou deixar pro Flávio te responder quando ele ver."
4. ZERO TELEMARKETING: É estritamente proibido usar frases como "Como posso ajudar hoje?", "Estou aqui para ajudar", ou "Em que mais posso ser útil?".
5. FIM DE PAPO: Se o usuário enviar apenas concordâncias como "Ok", "Valeu", "Obrigado", "Beleza" ou "Show", encerre com um simples "Por nada!", "Imagina!" ou apenas um emoji (👍). Não faça perguntas de acompanhamento.
6. RECADOS: Se pedirem para avisar algo, apenas confirme que vai repassar o recado ao Flávio.
7. ASSINATURA: Nunca assine a mensagem no final (ex: "Att, Hera").

HISTÓRICO DA CONVERSA:
${historicoFormatado || 'Sem histórico recente relevante.'}

MENSAGEM ATUAL DO USUÁRIO: "${textoUsuario}"
Responda de forma natural em português do Brasil:`;

            respostaFinal = await gerarTextoComFallback(
                [{ role: 'user', content: promptDeConversa }],
                0.2
            );
        }

        if (precisaApresentar) {
            const mensagemDeApresentacao = montarSaudacaoDeApresentacao(tipoDeContato);
            if (mensagemPareceSaudacaoSimples(textoUsuario)) {
                respostaFinal = `${saudacaoDoHorario}! ${mensagemDeApresentacao}`;
            } else {
                respostaFinal = `${mensagemDeApresentacao}\n\n${respostaFinal}`;
            }
        }

        respostaFinal = garantirTextoUtil(
            String(respostaFinal || '').replace(/\*\*/g, '*').trim(),
            '⚠️ Eu não consegui montar uma resposta agora. Tente reformular sua mensagem.'
        );

        if (!ehComandoEspecial) {
            respostaFinal = prefixarRespostaComoHera(respostaFinal);
        }

        termoBuscadoFinal = termoBuscadoFinal || 'Conversa';

        return {
            termoBuscado: termoBuscadoFinal,
            resposta: respostaFinal,
            ehComandoEspecial
        };

    } catch (erro) {
        console.error('Erro no processamento de texto com inteligência artificial:', erro);
        return {
            termoBuscado: 'Erro na inteligência artificial',
            resposta: 'Eu fiquei temporariamente indisponível no momento. Tente novamente em instantes.',
            ehComandoEspecial: false
        };
    }
}

async function resumirProcessoSEI(textoExtraido, numeroProcesso) {
    try {
        const prompt = `Você é um assessor administrativo especialista em licitações, compras e processos públicos (SEI). 
Analise atentamente a extração dos últimos 20 documentos do processo SEI nº ${numeroProcesso}.

Sua tarefa:
1. Resumo Executivo: Diga resumidamente do que se trata este processo.
2. Histórico Recente: Liste de forma cronológica os últimos movimentos mais importantes.
3. Status Atual ("Em que pé está"): Explique detalhadamente qual é a fase atual, com que área/setor está a bola, e o que falta para prosseguir.

Abaixo estão os textos extraídos dos documentos:
${textoExtraido}

Responda sempre em português do Brasil e com linguagem clara e direta.`;

        return await gerarTextoComFallback([{ role: 'user', content: prompt }], 0.3);
    } catch (erro) {
        console.error('Erro ao resumir o SEI:', erro);
        return 'Falha ao processar o resumo do processo SEI via inteligência artificial.';
    }
}

module.exports = {
    transcreverAudio,
    processarTextoComIA,
    analisarPerfilContato,
    consolidarMemoriaDeContato,
    textoEhComandoEspecial,
    resumirProcessoSEI
};