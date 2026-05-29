require('dotenv').config();

process.on('unhandledRejection', error => {
    console.error('Engasgo na rede evitado. O robô continua de pé.', error);
});

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeLib = require('qrcode');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const { transcreverAudio, processarTextoComIA, analisarPerfilContato } = require('./src/gemini');
const { dispararAlertasDeAta } = require('./src/notificacoes');
const { buscarItem } = require('./src/excel');

// Módulo de Memória Avançada (SQLite)
const {
    salvarMensagem,
    buscarHistoricoRecente,
    verificarTempoAusencia,
    dbSalvarConsulta,
    dbLerHistorico
} = require('./src/memoria');

const app = express();
app.use(express.json());

let qrCodeImagem = '';
let statusRobo = 'Iniciando o sistema...';

// MEMÓRIA DE CHATS PAUSADOS (Modo Humano)
const chatsPausados = new Set();

// ==========================================
// CONFIGURAÇÃO DA EMPRESA TERCEIRIZADA
// ==========================================
const caminhoConfiguracao = path.join(__dirname, './data/config.json');

function lerConfiguracao() {
    if (fs.existsSync(caminhoConfiguracao)) {
        return JSON.parse(fs.readFileSync(caminhoConfiguracao, 'utf-8'));
    }

    return { empresa: 'CNS' };
}

function salvarConfiguracao(dados) {
    const diretorioData = path.join(__dirname, './data');

    if (!fs.existsSync(diretorioData)) {
        fs.mkdirSync(diretorioData, { recursive: true });
    }

    fs.writeFileSync(caminhoConfiguracao, JSON.stringify(dados, null, 2));
}

function respostaPossuiTextoValido(texto) {
    return typeof texto === 'string' && texto.trim().length > 0;
}

function extrairComandoBuscar(texto) {
    const textoOriginal = String(texto || '').trim();

    if (!textoOriginal) {
        return null;
    }

    const match = textoOriginal.match(/^buscar\s+(.+)$/i);

    if (!match || !match[1]) {
        return null;
    }

    return match[1].trim();
}

// ==========================================
// 1. PAINEL WEB - ESTRUTURA
// ==========================================
const estiloCSS = `
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: #e0e5ec; color: #333; }
        .navbar { background: #2c3e50; padding: 15px; color: white; display: flex; gap: 20px; }
        .navbar a { color: white; text-decoration: none; font-weight: bold; }
        .navbar a:hover { color: #3498db; }
        .container { max-width: 1000px; margin: 30px auto; padding: 0 20px; }
        .card { background: white; padding: 25px; border-radius: 10px; box-shadow: 5px 5px 15px #c8d0e7, -5px -5px 15px #ffffff; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; }
        .btn { padding: 8px 15px; cursor: pointer; background: #3498db; color: white; border: none; border-radius: 5px; font-weight: bold; }
        .btn:hover { background: #2980b9; }
        .btn:disabled { background: #95a5a6; cursor: not-allowed; }
        .input-text { padding: 8px; font-size: 16px; border-radius: 5px; border: 1px solid #ccc; width: 200px; }
    </style>
`;

app.get('/', async (req, res) => {
    const historico = await dbLerHistorico();
    const configuracaoAtual = lerConfiguracao();
    let linhasTabela = '';

    historico.forEach(item => {
        linhasTabela += `<tr><td>${item.data}</td><td>${item.telefone}</td><td>${item.termo}</td></tr>`;
    });

    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="UTF-8"><title>Painel da Hera</title>${estiloCSS}</head>
    <body>
        <div class="navbar">
            <a href="/">🏠 Início</a>
            <a href="/contatos">👥 Analisar Contatos</a>
        </div>
        <div class="container">
            <h1>🤖 Painel de Controle - Hera</h1>

            <div class="card" style="background: #e8f4f8;">
                <h2>🏢 Gestão de Contrato Terceirizado</h2>
                <p>Defina o nome da empresa atual. A Hera usará esse nome para responder dúvidas baseadas nos PDFs da pasta <b>data/contrato/</b>.</p>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="text" id="nomeEmpresa" class="input-text" value="${configuracaoAtual.empresa}">
                    <button class="btn" onclick="salvarEmpresa()">💾 Salvar Empresa</button>
                </div>
            </div>

            <div class="card">
                <h2>Status: <span style="color: #007bff;">${statusRobo}</span></h2>
                ${qrCodeImagem ? `<img src="${qrCodeImagem}" alt="QR Code" style="max-width: 300px; border-radius: 10px;">` : '<p>Conectada e operando silenciosamente.</p>'}
            </div>

            <div class="card">
                <h2>Últimas Consultas</h2>
                <table><tr><th>Data/Hora</th><th>Número</th><th>Termo Buscado</th></tr>${linhasTabela}</table>
            </div>
        </div>
        <script>
            async function salvarEmpresa() {
                const nome = document.getElementById('nomeEmpresa').value;
                try {
                    const resposta = await fetch('/api/empresa', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ empresa: nome })
                    });
                    const dados = await resposta.json();
                    alert(dados.mensagem);
                } catch (erro) {
                    alert('Erro ao salvar empresa');
                }
            }

            if (window.location.pathname === '/') {
                setTimeout(() => location.reload(), 10000);
            }
        </script>
    </body>
    </html>
    `;

    res.send(html);
});

app.post('/api/empresa', (req, res) => {
    const { empresa } = req.body;
    salvarConfiguracao({ empresa });
    res.json({ mensagem: '✅ Nome da empresa atualizado com sucesso!' });
});

app.get('/contatos', async (req, res) => {
    if (!client || !client.info) {
        return res.send('<h2>Aguarde a Hera ficar Online e ler o QR Code primeiro!</h2><br><a href="/">Voltar</a>');
    }

    try {
        const chats = await client.getChats();
        const chatsIndividuais = chats.filter(chat => !chat.isGroup);

        let linhasTabela = '';

        chatsIndividuais.forEach(chat => {
            const numeroLimpo = chat.id.user;

            linhasTabela += `
            <tr>
                <td><strong>${chat.name || numeroLimpo}</strong></td>
                <td>${numeroLimpo}</td>
                <td>
                    <button class="btn" id="btn-${numeroLimpo}" onclick="mandarAnalisar('${chat.id._serialized}', '${numeroLimpo}')">
                        🧠 Analisar Perfil
                    </button>
                </td>
            </tr>`;
        });

        const html = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head><meta charset="UTF-8"><title>Contatos - Hera</title>${estiloCSS}</head>
        <body>
            <div class="navbar">
                <a href="/">🏠 Início</a>
                <a href="/contatos">👥 Analisar Contatos</a>
            </div>
            <div class="container">
                <h1>👥 Seus Contatos</h1>
                <div class="card">
                    <p>Selecione um contato abaixo para que a Hera leia as últimas mensagens silenciosamente e defina o tom de voz ideal para o perfil.</p>
                    <table>
                        <tr><th>Nome / Contato</th><th>Número</th><th>Ação (Invisível)</th></tr>
                        ${linhasTabela}
                    </table>
                </div>
            </div>

            <script>
                async function mandarAnalisar(chatId, numero) {
                    const botao = document.getElementById('btn-' + numero);
                    botao.innerText = '⏳ Analisando...';
                    botao.disabled = true;

                    try {
                        const resposta = await fetch('/api/analisar', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chatId })
                        });

                        const dados = await resposta.json();
                        alert(dados.mensagem);
                        botao.innerText = '✅ Analisado';
                    } catch (erro) {
                        alert('Erro ao tentar analisar. Verifique o terminal.');
                        botao.innerText = '❌ Erro';
                    }
                }
            </script>
        </body>
        </html>
        `;

        res.send(html);
    } catch (erro) {
        console.error(erro);
        res.send('Erro ao carregar os contatos.');
    }
});

app.post('/api/analisar', async (req, res) => {
    const { chatId } = req.body;

    try {
        const chatAlvo = await client.getChatById(chatId);
        const contatoAlvo = await chatAlvo.getContact();
        const mensagensAntigas = await chatAlvo.fetchMessages({ limit: 30 });

        const historicoLimpo = mensagensAntigas.map(mensagem => {
            const remetente = mensagem.fromMe ? 'Flávio' : (contatoAlvo.name || contatoAlvo.number);
            return `${remetente}: ${mensagem.body}`;
        }).join('\n');

        const idContatoLimpo = chatId.replace('@c.us', '');
        const respostaAnalise = await analisarPerfilContato(historicoLimpo, idContatoLimpo, contatoAlvo.name);

        res.json({ mensagem: respostaAnalise });
    } catch (erro) {
        console.error('Erro na API de análise silenciosa:', erro);
        res.json({ mensagem: '❌ Erro interno ao puxar o histórico. Tente novamente.' });
    }
});

app.listen(3000, () => {
    console.log('Painel Web da Hera rodando! Acesse: http://localhost:3000');
});

// ==========================================
// 2. ROBÔ DO WHATSAPP (HERA)
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: false,
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            '--disable-application-cache',
            '--disk-cache-size=0',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-features=NetworkService'
        ]
    }
});

client.on('qr', async qr => {
    statusRobo = 'Aguardando leitura do QR Code';
    qrCodeImagem = await qrcodeLib.toDataURL(qr);
});

client.on('ready', () => {
    statusRobo = 'Online e Pronta!';
    qrCodeImagem = '';
    console.log('Hera está online e pronta para ajudar!');

    cron.schedule('30 7 * * 1', async () => {
        console.log('📢 Hera iniciando disparo automático de atas semanal...');
        await dispararAlertasDeAta(client);
    }, { scheduled: true, timezone: 'America/Sao_Paulo' });
});

const tempoInicio = Date.now() / 1000;

client.on('message_create', async mensagem => {
    try {
        if (mensagem.timestamp < tempoInicio) {
            return;
        }

        if (mensagem.from === 'status@broadcast' || mensagem.to === 'status@broadcast') {
            return;
        }

        const ehGrupo = mensagem.from.includes('@g.us') || mensagem.to.includes('@g.us');
        if (ehGrupo) {
            return;
        }

        const textoMensagemOriginal = String(mensagem.body || '').trim();
        const textoMensagemNormalizado = textoMensagemOriginal.toLowerCase();

        const mensagemFoiEnviadaPorMim = mensagem.fromMe || mensagem.from === process.env.MEU_NUMERO;

        const idContato = mensagemFoiEnviadaPorMim
            ? mensagem.to.replace('@c.us', '')
            : mensagem.from.replace('@c.us', '');

        if (mensagemFoiEnviadaPorMim) {
            if (textoMensagemNormalizado === 'hera, disparar atas' || textoMensagemNormalizado === 'robô, disparar atas') {
                await mensagem.reply('⏳ _Iniciando varredura no estoque para disparar atas..._');
                const respostaDisparo = await dispararAlertasDeAta(client);
                await mensagem.reply(respostaDisparo);
                return;
            }

            if (textoMensagemOriginal === '&') {
                chatsPausados.add(idContato);

                try {
                    await mensagem.delete(true);
                } catch (erro) {
                    console.log('Não foi possível apagar a mensagem de pausa.', erro.message);
                }

                console.log(`⏸️ MODO HUMANO: Hera pausada para ${idContato}`);
                return;
            }

            if (textoMensagemOriginal === '&&') {
                chatsPausados.delete(idContato);

                try {
                    await mensagem.delete(true);
                } catch (erro) {
                    console.log('Não foi possível apagar a mensagem de reativação.', erro.message);
                }

                console.log(`▶️ MODO IA: Hera reativada para ${idContato}`);
                return;
            }

            return;
        }

        if (chatsPausados.has(idContato)) {
            return;
        }

        const contato = await mensagem.getContact();
        const chat = await mensagem.getChat();

        const infoContato = {
            isSaved: contato.isMyContact,
            name: contato.name,
            telefone: idContato
        };

        // 1. IMPORTAÇÃO INICIAL DE HISTÓRICO
        const historicoRecenteDB = await buscarHistoricoRecente(idContato, 1);

        if (historicoRecenteDB.length === 0) {
            console.log(`🔍 Primeiro contato de ${idContato} no banco. Importando histórico anterior...`);

            try {
                const mensagensAntigas = await chat.fetchMessages({ limit: 200 });

                console.log(`📥 ${mensagensAntigas.length} mensagens encontradas. Salvando no banco...`);

                for (const item of mensagensAntigas) {
                    if (item.body && String(item.body).trim()) {
                        const role = item.fromMe ? 'assistant' : 'user';
                        salvarMensagem(idContato, role, item.body);
                    }
                }

                console.log('✅ Histórico salvo com sucesso!');

                console.log(`🧠 Iniciando análise automática de perfil para ${idContato}...`);

                const amostraMensagens = mensagensAntigas.slice(-50);
                const amostraLimpa = amostraMensagens
                    .map(item => `${item.fromMe ? 'Flávio' : (contato.name || idContato)}: ${item.body}`)
                    .join('\n');

                analisarPerfilContato(amostraLimpa, idContato, contato.name)
                    .then(() => {
                        console.log(`✅ Perfil de ${idContato} gerado automaticamente!`);
                    })
                    .catch(erro => {
                        console.log('⚠️ Falha ao gerar perfil automático:', erro);
                    });
            } catch (erro) {
                console.error(`❌ Erro ao tentar puxar o histórico de ${idContato}:`, erro);
            }
        }

        // 2. GATILHO DE AUSÊNCIA E MEMÓRIA
        const precisaApresentar = await verificarTempoAusencia(idContato);
        const historicoParaIA = await buscarHistoricoRecente(idContato, 15);

        // 3. PROCESSAMENTO DE ÁUDIO
        if (mensagem.hasMedia && (mensagem.type === 'audio' || mensagem.type === 'ptt')) {
            await mensagem.reply('⏳ _Ouvindo o áudio..._');

            const media = await mensagem.downloadMedia();
            const textoTranscrito = await transcreverAudio(media.data, media.mimetype);

            if (respostaPossuiTextoValido(textoTranscrito)) {
                await mensagem.reply(`🎤 *Transcrição:*\n"${textoTranscrito.trim()}"`);

                salvarMensagem(idContato, 'user', textoTranscrito);

                try {
                    await chat.sendStateTyping();
                } catch (erro) {
                    console.log('Não foi possível ativar o indicador de digitação.', erro.message);
                }

                const resultadoIA = await processarTextoComIA(
                    textoTranscrito,
                    infoContato,
                    historicoParaIA,
                    precisaApresentar
                );

                const respostaFinal = respostaPossuiTextoValido(resultadoIA?.resposta)
                    ? resultadoIA.resposta
                    : '⚠️ Não consegui gerar uma resposta válida para o áudio.';

                console.log('🧠 Resposta final da Hera:', respostaFinal);

                salvarMensagem(idContato, 'assistant', respostaFinal);
                dbSalvarConsulta(idContato, resultadoIA?.termoBuscado || 'Áudio');

                await mensagem.reply(respostaFinal);
            } else {
                await mensagem.reply('⚠️ Não consegui transcrever esse áudio.');
            }

            try {
                await chat.markUnread();
            } catch (erro) {
                console.log('Não foi possível marcar a conversa como não lida.', erro.message);
            }

            return;
        }

        // 4. PROCESSAMENTO DE TEXTO
        if (!textoMensagemOriginal) {
            return;
        }

        salvarMensagem(idContato, 'user', textoMensagemOriginal);

        // ==========================================
        // COMANDO DIRETO: BUSCAR
        // ==========================================
        const termoDoComandoBuscar = extrairComandoBuscar(textoMensagemOriginal);

        if (termoDoComandoBuscar) {
            console.log(`🔎 Comando BUSCAR detectado para ${idContato}: ${termoDoComandoBuscar}`);

            let respostaBusca = buscarItem(termoDoComandoBuscar);

            if (!respostaPossuiTextoValido(respostaBusca)) {
                respostaBusca = `❌ Não consegui localizar resultados para "${termoDoComandoBuscar}" na planilha.`;
            }

            console.log('🧠 Resposta final da Hera:', respostaBusca);

            salvarMensagem(idContato, 'assistant', respostaBusca);
            dbSalvarConsulta(idContato, `Buscar: ${termoDoComandoBuscar}`);

            await mensagem.reply(respostaBusca);

            try {
                await chat.markUnread();
            } catch (erro) {
                console.log('Não foi possível marcar a conversa como não lida.', erro.message);
            }

            return;
        }

        try {
            await chat.sendStateTyping();
        } catch (erro) {
            console.log('Não foi possível ativar o indicador de digitação.', erro.message);
        }

        const resultadoIA = await processarTextoComIA(
            textoMensagemOriginal,
            infoContato,
            historicoParaIA,
            precisaApresentar
        );

        const respostaFinal = respostaPossuiTextoValido(resultadoIA?.resposta)
            ? resultadoIA.resposta
            : '⚠️ Eu não consegui gerar uma resposta válida agora.';

        console.log('🧠 Resposta final da Hera:', respostaFinal);

        salvarMensagem(idContato, 'assistant', respostaFinal);
        dbSalvarConsulta(idContato, resultadoIA?.termoBuscado || 'Conversa');

        await mensagem.reply(respostaFinal);

        try {
            await chat.markUnread();
        } catch (erro) {
            console.log('Não foi possível marcar a conversa como não lida.', erro.message);
        }
    } catch (erro) {
        console.error('❌ Erro geral ao processar mensagem:', erro);

        try {
            await mensagem.reply('❌ Ocorreu um erro interno ao processar sua mensagem.');
        } catch (erroEnvio) {
            console.error('❌ Falha ao enviar mensagem de erro:', erroEnvio);
        }
    }
});

client.initialize();