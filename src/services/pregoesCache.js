const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { pregoesCachePath } = require('../config/paths');

function garantirDiretorioDoBanco() {
    const diretorio = path.dirname(pregoesCachePath);
    if (!fs.existsSync(diretorio)) {
        fs.mkdirSync(diretorio, { recursive: true });
    }
}

function abrirBanco() {
    garantirDiretorioDoBanco();
    return new sqlite3.Database(pregoesCachePath);
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (erro) {
            if (erro) reject(erro);
            else resolve(this);
        });
    });
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (erro, row) => {
            if (erro) reject(erro);
            else resolve(row);
        });
    });
}

async function iniciarBancoPregoes() {
    const db = abrirBanco();
    try {
        await dbRun(db, `
            CREATE TABLE IF NOT EXISTS pregoes_resumo (
                id_compra TEXT PRIMARY KEY,
                numero_limpo TEXT,
                ano TEXT,
                situacao_geral TEXT,
                total_itens INTEGER,
                homologados INTEGER,
                desertos INTEGER,
                frustrados INTEGER,
                concluido BOOLEAN,
                atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } finally {
        db.close();
    }
}

async function buscarPregaoCache(idCompra) {
    const db = abrirBanco();
    try {
        return await dbGet(db, 'SELECT * FROM pregoes_resumo WHERE id_compra = ?', [idCompra]);
    } finally {
        db.close();
    }
}

async function salvarPregaoCache(dados) {
    const db = abrirBanco();
    try {
        await dbRun(db, `
            INSERT OR REPLACE INTO pregoes_resumo (
                id_compra, numero_limpo, ano, situacao_geral, total_itens, 
                homologados, desertos, frustrados, concluido, atualizado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
            dados.idCompra, dados.numeroLimpo, dados.ano, dados.situacaoGeral,
            dados.totalItens, dados.homologados, dados.desertos, dados.frustrados,
            dados.concluido ? 1 : 0
        ]);
    } finally {
        db.close();
    }
}

module.exports = {
    iniciarBancoPregoes,
    buscarPregaoCache,
    salvarPregaoCache,
    abrirBanco,
    dbGet
};