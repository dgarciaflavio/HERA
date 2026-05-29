const fs = require('fs');
const path = require('path');

const arquivoBD = path.join(__dirname, '../data/banco_historico.json');

function salvarConsulta(telefone, termo) {
    let dados = [];
    
    if (fs.existsSync(arquivoBD)) {
        const conteudo = fs.readFileSync(arquivoBD, 'utf-8');
        if (conteudo) dados = JSON.parse(conteudo);
    }
    
    dados.push({
        data: new Date().toLocaleString('pt-BR'),
        telefone: telefone.replace('@c.us', ''), 
        termo: termo
    });
    
    fs.writeFileSync(arquivoBD, JSON.stringify(dados, null, 2));
}

function lerHistorico() {
    if (fs.existsSync(arquivoBD)) {
        const conteudo = fs.readFileSync(arquivoBD, 'utf-8');
        return conteudo ? JSON.parse(conteudo) : [];
    }
    return [];
}

module.exports = { salvarConsulta, lerHistorico };