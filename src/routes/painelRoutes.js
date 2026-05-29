const { dbLerHistorico } = require('../services/memoria');
const { lerConfiguracao, salvarConfiguracao } = require('../services/configuracao');
const { renderPainel } = require('../views/painel');
const { renderContatos } = require('../views/contatos');
const { analisarPerfilContato } = require('../services/gemini');
const { getStatusRobo, getQrCodeImagem } = require('../core/state');

function registrarRotasPainel(app, client) {
    app.get('/', async (req, res) => {
        const historico = await dbLerHistorico();
        const configuracaoAtual = lerConfiguracao();

        const html = renderPainel({
            historico,
            configuracaoAtual,
            statusRobo: getStatusRobo(),
            qrCodeImagem: getQrCodeImagem()
        });

        res.send(html);
    });

    app.post('/api/config', (req, res) => {
        const { empresa, numerosSEI } = req.body;
        salvarConfiguracao({ empresa, numerosSEI });
        res.json({ mensagem: '✅ Configurações da Hera atualizadas com sucesso!' });
    });

    app.get('/contatos', async (req, res) => {
        if (!client || !client.info) {
            return res.send('<h2>Aguarde a Hera ficar Online e ler o QR Code primeiro!</h2><br><a href="/">Voltar</a>');
        }

        try {
            const chats = await client.getChats();
            const chatsIndividuais = chats.filter(chat => !chat.isGroup);
            res.send(renderContatos(chatsIndividuais));
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
}

module.exports = { registrarRotasPainel };