const fs = require('fs');
const { dataDir, configPath } = require('../config/paths');

function lerConfiguracao() {
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    return { empresa: 'CNS' };
}

function salvarConfiguracao(dados) {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(dados, null, 2));
}

module.exports = {
    lerConfiguracao,
    salvarConfiguracao
};