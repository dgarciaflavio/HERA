let qrCodeImagem = '';
let statusRobo = 'Iniciando o sistema...';

const chatsPausados = new Set();

function setQrCodeImagem(valor) {
    qrCodeImagem = valor;
}

function getQrCodeImagem() {
    return qrCodeImagem;
}

function setStatusRobo(valor) {
    statusRobo = valor;
}

function getStatusRobo() {
    return statusRobo;
}

module.exports = {
    chatsPausados,
    setQrCodeImagem,
    getQrCodeImagem,
    setStatusRobo,
    getStatusRobo
};