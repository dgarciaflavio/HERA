require('dotenv').config();

process.on('unhandledRejection', error => {
    console.error('Engasgo na rede evitado. O robô continua de pé.', error);
});
const { iniciarRotinaDeMemoria } = require('./jobs/consolidador'); // ajuste o caminho se precisar
const express = require('express');
const { criarClientWhatsApp } = require('./core/client');
const { registrarRotasPainel } = require('./routes/painelRoutes');
const { registrarEventosWhatsApp } = require('./whatsapp/handlers');

const app = express();
app.use(express.json());

const client = criarClientWhatsApp();

registrarRotasPainel(app, client);
registrarEventosWhatsApp(client);

app.listen(3000, () => {
    console.log('Painel Web da Hera rodando! Acesse: http://localhost:3000');
});

client.initialize();
iniciarRotinaDeMemoria();