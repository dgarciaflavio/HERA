const { estiloCSS } = require('./style');

function renderPainel({ historico, configuracaoAtual, statusRobo, qrCodeImagem }) {
    let linhasTabela = '';

    historico.forEach(item => {
        linhasTabela += `<tr><td>${item.data}</td><td>${item.telefone}</td><td>${item.termo}</td></tr>`;
    });

    return `
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
                <h2>⚙️ Configurações Gerais (Contrato e SEI)</h2>
                <p>Defina o nome da empresa e os <b>números autorizados a pesquisar no SEI</b> (separe os telefones por vírgula, ex: 5521999999999).</p>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <label><b>Empresa Terceirizada:</b></label>
                    <input type="text" id="nomeEmpresa" class="input-text" value="${configuracaoAtual.empresa || 'CNS'}">
                    
                    <label><b>Números Autorizados (SEI):</b></label>
                    <input type="text" id="numerosSEI" class="input-text" value="${configuracaoAtual.numerosSEI ? configuracaoAtual.numerosSEI.join(', ') : ''}">
                    
                    <button class="btn" style="width: 250px;" onclick="salvarConfiguracaoGeral()">💾 Salvar Configurações</button>
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
            async function salvarConfiguracaoGeral() {
                const nome = document.getElementById('nomeEmpresa').value;
                const numeros = document.getElementById('numerosSEI').value.split(',').map(n => n.trim()).filter(n => n);
                try {
                    const resposta = await fetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ empresa: nome, numerosSEI: numeros })
                    });
                    const dados = await resposta.json();
                    alert(dados.mensagem);
                } catch (erro) {
                    alert('Erro ao salvar configurações');
                }
            }

            if (window.location.pathname === '/') {
                setTimeout(() => location.reload(), 10000);
            }
        </script>
    </body>
    </html>
    `;
}

module.exports = { renderPainel };