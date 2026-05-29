const { estiloCSS } = require('./style');

function renderContatos(chatsIndividuais) {
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

    return `
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
}

module.exports = { renderContatos };