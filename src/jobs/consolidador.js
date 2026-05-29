const cron = require('node-cron');
const { 
    buscarContatosAtivosNasUltimas24h, 
    buscarTodoHistoricoDoDia, 
    buscarPerfil, 
    atualizarResumoPerfil 
} = require('../services/memoria');
const { consolidarMemoriaDeContato } = require('../services/gemini');
const { rotinaMadrugadaPregoes } = require('./atualizadorPregoes');

function iniciarRotinaDeMemoria() {
    // Rotina 1: Consolidar Memória - Roda todos os dias às 03:00 da manhã
    cron.schedule('0 3 * * *', async () => {
        console.log('🧠 [03:00] Iniciando consolidação de memória de longo prazo da Hera...');
        try {
            const telefones = await buscarContatosAtivosNasUltimas24h();
            
            if (telefones.length === 0) {
                console.log('📭 Nenhuma conversa nova nas últimas 24h para consolidar.');
                return;
            }

            for (const telefone of telefones) {
                const perfil = await buscarPerfil(telefone);
                const nome = perfil?.nome || 'Contato';
                const resumoAntigo = perfil?.resumo_perfil || '';

                const mensagens = await buscarTodoHistoricoDoDia(telefone);
                
                if (mensagens.length > 0) {
                    console.log(`📚 Consolidando memória de ${nome} (${telefone})...`);
                    
                    const novoResumo = await consolidarMemoriaDeContato(telefone, nome, resumoAntigo, mensagens);

                    if (novoResumo && novoResumo !== resumoAntigo) {
                        await atualizarResumoPerfil(telefone, novoResumo);
                        console.log(`✅ Ficha de memória de ${nome} atualizada com sucesso!`);
                    }
                }
                
                // Pequena pausa de 3 segundos entre contatos para não estourar limite da API (Rate Limit)
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            
            console.log('🏁 Consolidação de memória da madrugada concluída!');
        } catch (erro) {
            console.error('❌ Erro na rotina de memória de longo prazo:', erro);
        }
    });
    console.log('⏰ Rotina de consolidação de memória ativada (Agendada para as 03:00 AM).');

    // Rotina 2: Atualizar Pregões Pendentes - Roda todos os dias às 03:30 da manhã
    cron.schedule('30 3 * * *', async () => {
        await rotinaMadrugadaPregoes();
    });
    console.log('⏰ Rotina de atualização de pregões ativada (Agendada para as 03:30 AM).');
}

module.exports = { iniciarRotinaDeMemoria };