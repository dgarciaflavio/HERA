const sqlite3 = require('sqlite3').verbose();
const { bancoConversasPath } = require('../config/paths');

const db = new sqlite3.Database(bancoConversasPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS historico (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telefone TEXT,
        role TEXT,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS perfis (
        telefone TEXT PRIMARY KEY,
        nome TEXT,
        resumo_perfil TEXT,
        tom_de_voz TEXT,
        ultima_analise DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS consultas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT,
        telefone TEXT,
        termo TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS alertas_ata_enviados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item TEXT NOT NULL,
        telefone TEXT NOT NULL,
        data_envio TEXT NOT NULL,
        status TEXT DEFAULT 'ativo',
        possui_ae INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item, telefone, data_envio)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS cooldown_respostas (
        telefone TEXT PRIMARY KEY,
        ultimo_envio DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

function salvarPerfil(telefone, nome, resumo, tom) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT INTO perfis (telefone, nome, resumo_perfil, tom_de_voz, ultima_analise) 
                     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(telefone) DO UPDATE SET 
                     nome=excluded.nome,
                     resumo_perfil=excluded.resumo_perfil, 
                     tom_de_voz=excluded.tom_de_voz, 
                     ultima_analise=CURRENT_TIMESTAMP`;
        db.run(sql, [telefone, nome, resumo, tom], err => {
            if (err) reject(err); else resolve();
        });
    });
}

function buscarPerfil(telefone) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT nome, resumo_perfil, tom_de_voz FROM perfis WHERE telefone = ?`, [telefone], (err, row) => {
            if (err) reject(err); else resolve(row);
        });
    });
}

function salvarMensagem(telefone, role, content) {
    db.run(`INSERT INTO historico (telefone, role, content) VALUES (?, ?, ?)`, [telefone, role, content]);
}

function buscarHistoricoRecente(telefone, limite = 60) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT role, content FROM historico WHERE telefone = ? ORDER BY timestamp DESC LIMIT ?`,
            [telefone, limite],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows ? rows.reverse() : []);
            }
        );
    });
}

function verificarTempoAusencia(telefone) {
    return new Promise(resolve => {
        db.get(
            `SELECT timestamp FROM historico WHERE telefone = ? AND role = 'user' ORDER BY timestamp DESC LIMIT 1`,
            [telefone],
            (err, row) => {
                if (!row) return resolve(true);
                const ultimaMsg = new Date(row.timestamp).getTime();
                const agora = Date.now();
                const duasHoras = 2 * 60 * 60 * 1000;
                resolve((agora - ultimaMsg) > duasHoras);
            }
        );
    });
}

function dbSalvarConsulta(telefone, termo) {
    const data = new Date().toLocaleString('pt-BR');
    db.run(`INSERT INTO consultas (data, telefone, termo) VALUES (?, ?, ?)`, [data, telefone, termo]);
}

function dbLerHistorico() {
    return new Promise(resolve => {
        db.all(`SELECT data, telefone, termo FROM consultas ORDER BY id DESC LIMIT 50`, [], (err, rows) => {
            resolve(rows || []);
        });
    });
}

function obterDataHoje() {
    return new Date().toISOString().slice(0, 10);
}

function jaEnviadoHoje(item, telefone) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT id FROM alertas_ata_enviados WHERE item = ? AND telefone = ? AND data_envio = ?`,
            [String(item || '').trim(), telefone, obterDataHoje()],
            (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            }
        );
    });
}

function registrarEnvioAlertaAta(item, telefone, possuiAE = 0) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR IGNORE INTO alertas_ata_enviados (item, telefone, data_envio, status, possui_ae, updated_at) 
             VALUES (?, ?, ?, 'ativo', ?, CURRENT_TIMESTAMP)`,
            [String(item || '').trim(), telefone, obterDataHoje(), possuiAE ? 1 : 0],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            }
        );
    });
}

function marcarItemComAe(item) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE alertas_ata_enviados 
             SET status = 'inativo', 
                 possui_ae = 1, 
                 updated_at = CURRENT_TIMESTAMP 
             WHERE item = ? AND status = 'ativo'`,
            [String(item || '').trim()],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes || 0);
            }
        );
    });
}

function registrarRespostaAutomatica(telefone) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO cooldown_respostas (telefone, ultimo_envio) 
             VALUES (?, CURRENT_TIMESTAMP) 
             ON CONFLICT(telefone) DO UPDATE SET 
             ultimo_envio = CURRENT_TIMESTAMP`,
            [telefone],
            err => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

function contatoEstaEmCooldown(telefone, minutos = 30) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT ultimo_envio FROM cooldown_respostas WHERE telefone = ?`,
            [telefone],
            (err, row) => {
                if (err) { reject(err); return; }
                if (!row || !row.ultimo_envio) { resolve(false); return; }
                const ultimoEnvio = new Date(row.ultimo_envio).getTime();
                const agora = Date.now();
                const janela = minutos * 60 * 1000;
                resolve((agora - ultimoEnvio) < janela);
            }
        );
    });
}

// --- NOVAS FUNÇÕES PARA A MEMÓRIA DE LONGO PRAZO ---

function buscarContatosAtivosNasUltimas24h() {
    return new Promise((resolve, reject) => {
        // Busca apenas quem enviou mensagem ('user') no último dia
        const query = `SELECT DISTINCT telefone FROM historico WHERE timestamp >= datetime('now', '-1 day') AND role = 'user'`;
        db.all(query, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.telefone));
        });
    });
}

function buscarTodoHistoricoDoDia(telefone) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT role, content FROM historico WHERE telefone = ? AND timestamp >= datetime('now', '-1 day') ORDER BY timestamp ASC`,
            [telefone],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

function atualizarResumoPerfil(telefone, novoResumo) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE perfis SET resumo_perfil = ?, ultima_analise = CURRENT_TIMESTAMP WHERE telefone = ?`,
            [novoResumo, telefone],
            err => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

module.exports = {
    salvarMensagem,
    buscarHistoricoRecente,
    verificarTempoAusencia,
    salvarPerfil,
    buscarPerfil,
    dbSalvarConsulta,
    dbLerHistorico,
    jaEnviadoHoje,
    registrarEnvioAlertaAta,
    marcarItemComAe,
    registrarRespostaAutomatica,
    contatoEstaEmCooldown,
    buscarContatosAtivosNasUltimas24h,
    buscarTodoHistoricoDoDia,
    atualizarResumoPerfil,
    db
};