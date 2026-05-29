const qrcodeLib = require('qrcode');
const cron = require('node-cron');
const { dispararAlertasDeAta } = require('../services/notificacoes');
const { processarMensagemRecebida } = require('./messageProcessor');
const { atualizarCatalogoSidecAtivo } = require('../services/sidecCatalogoUpdater');
const {
    setStatusRobo,
    setQrCodeImagem
} = require('../core/state');

function registrarEventosWhatsApp(client) {
    client.on('qr', async qr => {
        setStatusRobo('Aguardando leitura do QR Code');
        setQrCodeImagem(await qrcodeLib.toDataURL(qr));
    });

    client.on('ready', () => {
        setStatusRobo('Online e Pronta!');
        setQrCodeImagem('');
        console.log('Hera está online e pronta para ajudar!');

        cron.schedule('30 7 * * *', async () => {
            console.log('📢 Hera iniciando disparo automático diário de atas...');
            await dispararAlertasDeAta(client);
        }, { scheduled: true, timezone: 'America/Sao_Paulo' });

        cron.schedule('30 2 * * *', async () => {
            console.log('🌙 Hera iniciando atualização noturna do catálogo SIDEC...');
            await atualizarCatalogoSidecAtivo();
        }, { scheduled: true, timezone: 'America/Sao_Paulo' });
    });

    const tempoInicio = Date.now() / 1000;

    client.on('message_create', async mensagem => {
        await processarMensagemRecebida({ client, mensagem, tempoInicio });
    });
}

module.exports = { registrarEventosWhatsApp };