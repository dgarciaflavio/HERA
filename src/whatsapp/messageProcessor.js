const fs = require('fs');
const path = require('path');
const os = require('os');
const { MessageMedia } = require('whatsapp-web.js');

const {
    salvarMensagem,
    buscarHistoricoRecente,
    verificarTempoAusencia,
    dbSalvarConsulta,
    contatoEstaEmCooldown,
    registrarRespostaAutomatica
} = require('../services/memoria');

const { listarDocumentosSEI, extrairDocumentoSEIPdf } = require('../services/sei');
const { lerConfiguracao } = require('../services/configuracao');

const {
    transcreverAudio,
    processarTextoComIA,
    analisarPerfilContato,
    textoEhComandoEspecial,
    resumirProcessoSEI
} = require('../services/gemini');

const { dispararAlertasDeAta } = require('../services/notificacoes');
const { buscarItem, buscarItensEmLote } = require('../services/excel');
const { consultarDfd, cadastrarPca } = require('../services/dfd');
const { processarArquivoExcelSidec } = require('../services/sidecExcel');
const { atualizarCatalogoSidecAtivo } = require('../services/sidecCatalogoUpdater');

const {
    debugCodigoSidecMaterial,
    bloquearCodigoSidec,
    desbloquearCodigoSidec,
    listarBloqueiosSidec
} = require('../services/sidec');

const {
    consultarItensPregao,
    consultarContratos,
    gerarRelatorioPregoesAno
} = require('../services/api');

const { chatsPausados } = require('../core/state');

const {
    respostaPossuiTextoValido,
    extrairComandoBuscar,
    extrairListaDeItens,
    extrairCodigosDeItens,
    extrairNumeroPregao,
    extrairComandoContrato,
    extrairComandoDfd,
    ehComandoCadastroPca
} = require('../utils/texto');

const MENSAGEM_SEM_AUTORIZACAO_CONSULTA =
    'Você não pode fazer essa consulta pois seu número não está salvo, enviei para o Flavio verificar e te dar um retorno.';

const cadastrosPcaEmAndamento = new Map();
const sessoesSeiEmAndamento = new Map();

function garantirDiretorio(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function extensaoPareceExcel(filename = '') {
    const nome = String(filename || '').toLowerCase().trim();
    return nome.endsWith('.xlsx') || nome.endsWith('.xlsm') || nome.endsWith('.xls');
}

function extrairCodigoDoComandoDebugSidec(texto) {
    const match = String(texto || '').trim().match(/^hera,\s*debug\s+sidec\s+([A-Z0-9.-]+)$/i);
    return match ? match[1].trim() : null;
}

function ehComandoAtualizarCatalogoSidec(texto) {
    return /^hera,\s*atualizar\s+cat[áa]logo\s+sidec$/i.test(String(texto || '').trim());
}

function extrairComandoBloquearSidec(texto) {
    const match = String(texto || '').trim().match(/^hera,\s*bloquear\s+sidec\s+([A-Z0-9.-]+)\s+(.+)$/i);
    if (!match) {
        return null;
    }
    return {
        codigo: match[1].trim(),
        motivo: match[2].trim()
    };
}

function extrairComandoDesbloquearSidec(texto) {
    const match = String(texto || '').trim().match(/^hera,\s*desbloquear\s+sidec\s+([A-Z0-9.-]+)$/i);
    return match ? match[1].trim() : null;
}

function ehComandoListarBloqueiosSidec(texto) {
    return /^hera,\s*listar\s+bloqueios\s+sidec$/i.test(String(texto || '').trim());
}

function contatoPodeConsultarPlanilha(contato) {
    const nome = String(contato?.name || '').toUpperCase();
    return nome.includes('INCA');
}

function mensagemFoiEnviadaPorMimMesmo(idContato, mensagemFoiEnviadaPorMim) {
    const meuNumero = String(process.env.MEU_NUMERO || '').replace(/\D/g, '');
    const contatoAtual = String(idContato || '').replace(/\D/g, '');
    return Boolean(mensagemFoiEnviadaPorMim && meuNumero && contatoAtual && meuNumero === contatoAtual);
}

function contatoPodeCadastrarPca(contato, mensagemFoiEnviadaPorMim, idContato) {
    if (mensagemFoiEnviadaPorMimMesmo(idContato, mensagemFoiEnviadaPorMim)) {
        return true;
    }
    return contatoPodeConsultarPlanilha(contato);
}

function montarAlertaIrpSeNecessario(resultado) {
    const resultados = resultado?.resultados || [];
    const temNaoUtilizavel = resultados.some(item => item.Status === 'Não utilizável');
    const temNaoEncontrado = resultados.some(item => item.Status === 'Não Encontrado');
    const temSugestao = resultados.some(item => String(item.Novo_Cod || '').trim() && String(item.Novo_Cod || '').trim() !== '-');

    if (!temNaoUtilizavel && !temNaoEncontrado && !temSugestao) {
        return null;
    }

    let alerta = `⚠️ *Atenção ao lançar a IRP:*\n\n`;
    alerta += `- Sempre valide o item no catálogo visual do Compras.gov.br antes do lançamento.\n`;
    alerta += `- A API pública pode indicar um item como utilizável mesmo quando o portal o trata como suspenso ou não utilizável.\n`;

    if (temNaoUtilizavel) {
        alerta += `- Há item(ns) marcado(s) como *Não utilizável* nesta planilha. Não lance o código original sem conferência.\n`;
    }
    if (temNaoEncontrado) {
        alerta += `- Há item(ns) *Não encontrados*. Revise manualmente antes de seguir.\n`;
    }
    if (temSugestao) {
        alerta += `- Há sugestão(ões) de substituição. Confirme o SIDEC sugerido no catálogo antes de usar na IRP.\n`;
    }

    alerta += `- Em caso de divergência entre planilha, API e portal, priorize a validação final no catálogo visual.`;
    return alerta;
}

async function processarDocumentoExcelWhatsApp({ mensagem, chat, idContato }) {
    const media = await mensagem.downloadMedia();
    if (!media) {
        await mensagem.reply('Não consegui baixar o arquivo enviado.');
        return true;
    }

    const nomeArquivo = media.filename || `arquivo_${Date.now()}.xlsx`;
    if (!extensaoPareceExcel(nomeArquivo)) {
        return false;
    }

    const dirTemp = path.join(os.tmpdir(), 'hera-whatsapp-excel');
    garantirDiretorio(dirTemp);
    const caminhoEntrada = path.join(dirTemp, `${Date.now()}_${nomeArquivo}`);
    fs.writeFileSync(caminhoEntrada, Buffer.from(media.data, 'base64'));

    await mensagem.reply(
        '🔄 Recebi sua planilha.\n\n' +
        '⏳ Vou validar os códigos SIDEC, verificar os PDMs e procurar substitutos para os itens não utilizáveis.\n' +
        'Isso pode levar alguns minutos, dependendo do tamanho do arquivo.'
    );

    let ultimoAviso = 0;

    try {
        const resultado = await processarArquivoExcelSidec(caminhoEntrada, {
            concorrencia: 3,
            onProgress: async ({ total, processadas, etapa }) => {
                if (etapa !== 'processando') {
                    return;
                }
                const agora = Date.now();
                if (agora - ultimoAviso < 30000) {
                    return;
                }
                ultimoAviso = agora;
                try {
                    await mensagem.reply(`📊 Processamento em andamento: ${processadas}/${total} linha(s) concluídas.`);
                } catch (erro) {}
            }
        });

        const mediaResultado = MessageMedia.fromFilePath(resultado.caminhoSaida);
        await chat.sendMessage(mediaResultado, {
            caption:
                '✅ Processamento concluído.\n\n' +
                `Linhas válidas: ${resultado.resumo.totalLinhasValidas}\n` +
                `Utilizáveis: ${resultado.resultados.filter(r => r.Status === 'Utilizável').length}\n` +
                `Não utilizáveis: ${resultado.resultados.filter(r => r.Status === 'Não utilizável').length}\n` +
                `Não encontrados: ${resultado.resumo.naoEncontrados}\n\n` +
                'Estou enviando a planilha com o resultado completo.'
        });

        const alertaIrp = montarAlertaIrpSeNecessario(resultado);
        if (alertaIrp) {
            await mensagem.reply(alertaIrp);
            salvarMensagem(idContato, 'assistant', alertaIrp);
            dbSalvarConsulta(idContato, 'Alerta IRP após processamento SIDEC');
        }

        salvarMensagem(idContato, 'assistant', `Planilha SIDEC processada: ${nomeArquivo}`);
        dbSalvarConsulta(idContato, `Processamento Excel SIDEC: ${nomeArquivo}`);

        try { fs.unlinkSync(caminhoEntrada); } catch (erro) {}
        try { fs.unlinkSync(resultado.caminhoSaida); } catch (erro) {}
        try { await chat.markUnread(); } catch (erro) {}

        return true;
    } catch (erro) {
        console.error('❌ Erro ao processar Excel do WhatsApp:', erro);
        await mensagem.reply(
            '❌ Ocorreu um erro ao processar a planilha enviada.\n' +
            'Verifique se o arquivo contém as colunas "Código Sidec" e "Descrição do Material".'
        );
        try { fs.unlinkSync(caminhoEntrada); } catch (erro2) {}
        try { await chat.markUnread(); } catch (erro2) {}
        return true;
    }
}

async function responderEtapaCadastroPca({ mensagem, chat, idContato, textoMensagemOriginal }) {
    const sessao = cadastrosPcaEmAndamento.get(idContato);
    if (!sessao) {
        return false;
    }

    const texto = String(textoMensagemOriginal || '').trim();

    if (!texto) {
        await mensagem.reply('Não entendi sua resposta. Tente novamente.');
        try { await chat.markUnread(); } catch (erro) {}
        return true;
    }

    if (sessao.etapa === 'aguardando_ano') {
        if (!/^\d{4}$/.test(texto)) {
            await mensagem.reply('❌ Informe o Ano do PCA no formato AAAA. Exemplo: 2026');
            try { await chat.markUnread(); } catch (erro) {}
            return true;
        }
        sessao.ano = texto;
        sessao.etapa = 'aguardando_id_pca_pncp';
        cadastrosPcaEmAndamento.set(idContato, sessao);

        const resposta = 'Perfeito. Agora me envie o:\n\nId pca PNCP:';
        salvarMensagem(idContato, 'assistant', resposta);
        dbSalvarConsulta(idContato, `CadastroPCA etapa ID - ano ${texto}`);
        await mensagem.reply(resposta);
        try { await chat.markUnread(); } catch (erro) {}
        return true;
    }

    if (sessao.etapa === 'aguardando_id_pca_pncp') {
        sessao.idPcaPncp = texto;
        sessao.etapa = 'aguardando_data_publicacao';
        cadastrosPcaEmAndamento.set(idContato, sessao);

        const resposta = 'Agora me envie a:\n\nData de publicação no PNCP:';
        salvarMensagem(idContato, 'assistant', resposta);
        dbSalvarConsulta(idContato, `CadastroPCA etapa data - ano ${sessao.ano}`);
        await mensagem.reply(resposta);
        try { await chat.markUnread(); } catch (erro) {}
        return true;
    }

    if (sessao.etapa === 'aguardando_data_publicacao') {
        const resultado = cadastrarPca({
            ano: sessao.ano,
            idPcaPncp: sessao.idPcaPncp,
            dataPublicacaoPncp: texto
        });

        cadastrosPcaEmAndamento.delete(idContato);

        salvarMensagem(idContato, 'assistant', resultado.mensagem);
        dbSalvarConsulta(idContato, `CadastroPCA concluído ${sessao.ano}`);
        await mensagem.reply(resultado.mensagem);
        try { await chat.markUnread(); } catch (erro) {}
        return true;
    }

    return false;
}

async function responderMenuSEI({ mensagem, chat, idContato, textoMensagemOriginal }) {
    const sessao = sessoesSeiEmAndamento.get(idContato);
    if (!sessao) return false;

    const texto = String(textoMensagemOriginal || '').trim();
    const indiceEscolhido = parseInt(texto) - 1;

    // Se o usuário digitar "cancelar" ou "sair"
    if (texto.toLowerCase() === 'cancelar' || texto.toLowerCase() === 'sair') {
        sessoesSeiEmAndamento.delete(idContato);
        await mensagem.reply('✅ Consulta ao SEI cancelada com sucesso.');
        try { await chat.markUnread(); } catch (erro) {}
        return true;
    }

    // Se a pessoa digitou qualquer coisa que não seja um número válido do menu
    if (isNaN(indiceEscolhido) || indiceEscolhido < 0 || indiceEscolhido >= sessao.documentos.length) {
        await mensagem.reply(`❌ Opção inválida. Por favor, digite um número de *1 a ${sessao.documentos.length}* ou digite *cancelar*.`);
        try { await chat.markUnread(); } catch (erro) {}
        return true;
    }

    const documentoEscolhido = sessao.documentos[indiceEscolhido];
    await mensagem.reply(`⏳ Entendido! Retornando ao processo para extrair o arquivo: *${documentoEscolhido}*\nIsso levará poucos segundos...`);
    
    try {
        const caminhoPDF = await extrairDocumentoSEIPdf(sessao.processo, documentoEscolhido);
        
        // Envia o PDF via WhatsApp
        const media = MessageMedia.fromFilePath(caminhoPDF);
        await chat.sendMessage(media, { caption: `📄 Aqui está o seu documento do SEI!\n\nProcesso: ${sessao.processo}\nArquivo: ${documentoEscolhido}` });
        
        // Apaga o arquivo temporário do servidor para economizar espaço
        try { fs.unlinkSync(caminhoPDF); } catch(e) {}
        
        salvarMensagem(idContato, 'assistant', `Enviado PDF do SEI: ${documentoEscolhido}`);
        dbSalvarConsulta(idContato, `PDF SEI extraído: ${sessao.processo}`);
    } catch (erro) {
        console.error('Erro ao extrair PDF:', erro);
        await mensagem.reply(`❌ Ocorreu um erro ao gerar o PDF deste documento: ${erro.message}`);
    }

    // Finaliza a sessão independentemente de ter dado certo ou erro técnico
    sessoesSeiEmAndamento.delete(idContato);
    try { await chat.markUnread(); } catch (erro) {}
    
    return true; // Retorna true informando que a mensagem foi tratada pelo interceptador
}

async function processarMensagemRecebida({ client, mensagem, tempoInicio }) {
    try {
        if (mensagem.timestamp < tempoInicio) {
            return;
        }

        if (mensagem.from === 'status@broadcast' || mensagem.to === 'status@broadcast') {
            return;
        }

        const ehGrupo = mensagem.from.includes('@g.us') || mensagem.to.includes('@g.us');
        if (ehGrupo) {
            return;
        }

        let textoMensagemOriginal = String(mensagem.body || '').trim();
        const textoMensagemNormalizado = textoMensagemOriginal.toLowerCase();
        const mensagemFoiEnviadaPorMim = mensagem.fromMe || mensagem.from === process.env.MEU_NUMERO;
        const idContato = mensagemFoiEnviadaPorMim
            ? mensagem.to.replace('@c.us', '')
            : mensagem.from.replace('@c.us', '');

        const ehConversaComigoMesmo = mensagemFoiEnviadaPorMimMesmo(idContato, mensagemFoiEnviadaPorMim);

        if (mensagemFoiEnviadaPorMim && !ehConversaComigoMesmo) {
            if (textoMensagemNormalizado === 'hera, disparar atas' || textoMensagemNormalizado === 'robô, disparar atas') {
                await mensagem.reply('🤖 _Iniciando varredura no estoque para disparar atas..._');
                const respostaDisparo = await dispararAlertasDeAta(client);
                await mensagem.reply(respostaDisparo);
                return;
            }

            if (textoMensagemOriginal === '&') {
                chatsPausados.add(idContato);
                try { await mensagem.delete(true); } catch (erro) {}
                console.log(`⏸️ MODO HUMANO: Hera pausada para ${idContato}`);
                return;
            }

            if (textoMensagemOriginal === '&&') {
                chatsPausados.delete(idContato);
                try { await mensagem.delete(true); } catch (erro) {}
                console.log(`▶️ MODO IA: Hera reativada para ${idContato}`);
                return;
            }

            return;
        }

        if (!mensagemFoiEnviadaPorMim && chatsPausados.has(idContato)) {
            return;
        }

        const contato = await mensagem.getContact();
        const chat = await mensagem.getChat();

        if (mensagem.hasMedia && mensagem.type === 'document') {
            const mediaInfo = await mensagem.downloadMedia().catch(() => null);
            if (mediaInfo && extensaoPareceExcel(mediaInfo.filename || '')) {
                const foiTratado = await processarDocumentoExcelWhatsApp({ mensagem, chat, idContato });
                if (foiTratado) {
                    return;
                }
            }
        }

        const infoContato = {
            isSaved: contato.isMyContact,
            name: contato.name,
            telefone: idContato
        };

        const historicoRecenteDB = await buscarHistoricoRecente(idContato, 1);
        if (historicoRecenteDB.length === 0) {
            console.log(`📚 Primeiro contato de ${idContato} no banco. Importando histórico anterior...`);
            try {
                const mensagensAntigas = await chat.fetchMessages({ limit: 3000 });
                for (const item of mensagensAntigas) {
                    if (item.body && String(item.body).trim()) {
                        const role = item.fromMe ? 'assistant' : 'user';
                        salvarMensagem(idContato, role, item.body);
                    }
                }

                const amostraMensagens = mensagensAntigas.slice(-50);
                const amostraLimpa = amostraMensagens
                    .map(item => `${item.fromMe ? 'Flávio' : (contato.name || idContato)}: ${item.body}`)
                    .join('\n');

                analisarPerfilContato(amostraLimpa, idContato, contato.name)
                    .then(() => console.log(`🧠 Perfil de ${idContato} gerado automaticamente!`))
                    .catch(() => console.log('❌ Falha ao gerar perfil automático.'));

            } catch (erro) {
                console.error(`❌ Erro ao tentar puxar o histórico de ${idContato}:`, erro);
            }
        }

        const precisaApresentar = await verificarTempoAusencia(idContato);
        const historicoParaIA = await buscarHistoricoRecente(idContato, 60);

        if (mensagem.hasMedia && (mensagem.type === 'audio' || mensagem.type === 'ptt')) {
            await mensagem.reply('🎧 _Ouvindo o áudio..._');
            const media = await mensagem.downloadMedia();
            const textoTranscrito = await transcreverAudio(media.data, media.mimetype);

            if (respostaPossuiTextoValido(textoTranscrito)) {
                await mensagem.reply(`📝 *Transcrição:*\n"${textoTranscrito.trim()}"`);
                textoMensagemOriginal = textoTranscrito;
            } else {
                await mensagem.reply('Não consegui transcrever esse áudio.');
                try { await chat.markUnread(); } catch (erro) {}
                return;
            }
        }

        if (!textoMensagemOriginal) {
            return;
        }

        salvarMensagem(idContato, 'user', textoMensagemOriginal);

        if (cadastrosPcaEmAndamento.has(idContato)) {
            const foiTratadoCadastroPca = await responderEtapaCadastroPca({
                mensagem,
                chat,
                idContato,
                textoMensagemOriginal
            });
            if (foiTratadoCadastroPca) {
                return;
            }
        }
		
		if (sessoesSeiEmAndamento.has(idContato)) {
            const foiTratadoMenuSei = await responderMenuSEI({
                mensagem, chat, idContato, textoMensagemOriginal
            });
            if (foiTratadoMenuSei) return;
        }

        if (ehComandoCadastroPca(textoMensagemOriginal)) {
            if (!contatoPodeCadastrarPca(contato, mensagemFoiEnviadaPorMim, idContato)) {
                await mensagem.reply(MENSAGEM_SEM_AUTORIZACAO_CONSULTA);
                salvarMensagem(idContato, 'assistant', MENSAGEM_SEM_AUTORIZACAO_CONSULTA);
                dbSalvarConsulta(idContato, 'CadastroPCA negado sem autorização');
                try { await chat.markUnread(); } catch (erro) {}
                return;
            }

            cadastrosPcaEmAndamento.set(idContato, {
                etapa: 'aguardando_ano',
                ano: '',
                idPcaPncp: ''
            });

            const resposta = 'Vamos cadastrar um PCA.\n\nMe envie o Ano do PCA:';
            salvarMensagem(idContato, 'assistant', resposta);
            dbSalvarConsulta(idContato, 'Início CadastroPCA');
            await mensagem.reply(resposta);
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        if (ehComandoAtualizarCatalogoSidec(textoMensagemOriginal)) {
            await mensagem.reply('⏳ Iniciando atualização manual do catálogo SIDEC. Isso pode levar alguns minutos...');
            const resultadoAtualizacao = await atualizarCatalogoSidecAtivo();

            if (resultadoAtualizacao?.sucesso) {
                const resposta =
                    `✅ Catálogo SIDEC atualizado com sucesso.\n\n` +
                    `Itens gravados: ${resultadoAtualizacao.totalInseridos}\n` +
                    `Suspensos/Não utilizáveis ignorados: ${resultadoAtualizacao.totalSuspensosIgnorados}`;

                salvarMensagem(idContato, 'assistant', resposta);
                dbSalvarConsulta(idContato, 'Atualização manual catálogo SIDEC');
                await mensagem.reply(resposta);
            } else {
                const resposta =
                    `❌ Falha ao atualizar o catálogo SIDEC.\n` +
                    `Erro: ${resultadoAtualizacao?.erro || 'desconhecido'}`;

                salvarMensagem(idContato, 'assistant', resposta);
                dbSalvarConsulta(idContato, 'Falha atualização catálogo SIDEC');
                await mensagem.reply(resposta);
            }
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        const codigoDebugSidec = extrairCodigoDoComandoDebugSidec(textoMensagemOriginal);
        if (codigoDebugSidec) {
            await mensagem.reply(`⏳ Gerando debug do SIDEC ${codigoDebugSidec}...`);
            const respostaDebug = await debugCodigoSidecMaterial(codigoDebugSidec);

            salvarMensagem(idContato, 'assistant', respostaDebug);
            dbSalvarConsulta(idContato, `Debug SIDEC ${codigoDebugSidec}`);
            await mensagem.reply(respostaDebug);
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        const comandoBloquear = extrairComandoBloquearSidec(textoMensagemOriginal);
        if (comandoBloquear) {
            const resultado = bloquearCodigoSidec(comandoBloquear.codigo, comandoBloquear.motivo);

            salvarMensagem(idContato, 'assistant', resultado.mensagem);
            dbSalvarConsulta(idContato, `Bloquear SIDEC ${comandoBloquear.codigo}`);
            await mensagem.reply(resultado.mensagem);
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        const codigoDesbloquear = extrairComandoDesbloquearSidec(textoMensagemOriginal);
        if (codigoDesbloquear) {
            const resultado = desbloquearCodigoSidec(codigoDesbloquear);

            salvarMensagem(idContato, 'assistant', resultado.mensagem);
            dbSalvarConsulta(idContato, `Desbloquear SIDEC ${codigoDesbloquear}`);
            await mensagem.reply(resultado.mensagem);
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        if (ehComandoListarBloqueiosSidec(textoMensagemOriginal)) {
            const bloqueios = listarBloqueiosSidec();

            let resposta = '';
            if (!bloqueios.length) {
                resposta = 'Nenhum código SIDEC bloqueado manualmente no momento.';
            } else {
                resposta = `📋 *Bloqueios manuais SIDEC (${bloqueios.length})*\n\n`;
                bloqueios.forEach(item => {
                    resposta += `- *${item.codigo}* — ${item.motivo}\n`;
                });
            }

            salvarMensagem(idContato, 'assistant', resposta);
            dbSalvarConsulta(idContato, 'Listar bloqueios SIDEC');
            await mensagem.reply(resposta);
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        const comandoDfd = extrairComandoDfd(textoMensagemOriginal);
        if (comandoDfd) {
            if (!contatoPodeConsultarPlanilha(contato) && !ehConversaComigoMesmo) {
                await mensagem.reply(MENSAGEM_SEM_AUTORIZACAO_CONSULTA);
                salvarMensagem(idContato, 'assistant', MENSAGEM_SEM_AUTORIZACAO_CONSULTA);
                dbSalvarConsulta(idContato, 'Consulta negada - DFD sem autorização');
                try { await chat.markUnread(); } catch (erro) {}
                return;
            }

            console.log(`🔎 Comando DFD detectado para ${idContato}: ${comandoDfd}`);
            const respostaDfd = consultarDfd(comandoDfd);
            salvarMensagem(idContato, 'assistant', respostaDfd);
            dbSalvarConsulta(idContato, `DFD: ${comandoDfd}`);
            await mensagem.reply(respostaDfd);
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        const listaDeItens = extrairListaDeItens(textoMensagemOriginal);
        if (listaDeItens.length > 0) {
            if (!contatoPodeConsultarPlanilha(contato) && !ehConversaComigoMesmo) {
                await mensagem.reply(MENSAGEM_SEM_AUTORIZACAO_CONSULTA);
                salvarMensagem(idContato, 'assistant', MENSAGEM_SEM_AUTORIZACAO_CONSULTA);
                dbSalvarConsulta(idContato, 'Consulta negada - lista de itens sem autorização');
                try { await chat.markUnread(); } catch (erro) {}
                return;
            }

            console.log(`📦 Lista de itens detectada para ${idContato}: ${listaDeItens.join(', ')}`);
            const resultados = buscarItensEmLote(listaDeItens);

            for (const resultado of resultados) {
                let respostaBusca = resultado.resposta;
                if (!respostaPossuiTextoValido(respostaBusca)) {
                    respostaBusca = `Não consegui localizar resultados para "${resultado.codigo}" na planilha.`;
                }

                salvarMensagem(idContato, 'assistant', respostaBusca);
                dbSalvarConsulta(idContato, `Buscar lista: ${resultado.codigo}`);
                await mensagem.reply(respostaBusca);
                await new Promise(resolve => setTimeout(resolve, 700));
            }
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        const termoDoComandoBuscar = extrairComandoBuscar(textoMensagemOriginal);
        if (termoDoComandoBuscar) {
            if (!contatoPodeConsultarPlanilha(contato) && !ehConversaComigoMesmo) {
                await mensagem.reply(MENSAGEM_SEM_AUTORIZACAO_CONSULTA);
                salvarMensagem(idContato, 'assistant', MENSAGEM_SEM_AUTORIZACAO_CONSULTA);
                dbSalvarConsulta(idContato, 'Consulta negada - buscar sem autorização');
                try { await chat.markUnread(); } catch (erro) {}
                return;
            }

            console.log(`🔎 Comando BUSCAR detectado para ${idContato}: ${termoDoComandoBuscar}`);

            const codigosDetectados = extrairCodigosDeItens(termoDoComandoBuscar);
            if (codigosDetectados.length > 1) {
                console.log(`📦 Busca em lote detectada para ${idContato}: ${codigosDetectados.join(', ')}`);
                const resultados = buscarItensEmLote(codigosDetectados);

                for (const resultado of resultados) {
                    let respostaBusca = resultado.resposta;
                    if (!respostaPossuiTextoValido(respostaBusca)) {
                        respostaBusca = `Não consegui localizar resultados para "${resultado.codigo}" na planilha.`;
                    }
                    salvarMensagem(idContato, 'assistant', respostaBusca);
                    dbSalvarConsulta(idContato, `Buscar lote: ${resultado.codigo}`);
                    await mensagem.reply(respostaBusca);
                    await new Promise(resolve => setTimeout(resolve, 700));
                }
                try { await chat.markUnread(); } catch (erro) {}
                return;
            }

            let respostaBusca = buscarItem(termoDoComandoBuscar);

            if (!respostaPossuiTextoValido(respostaBusca)) {
                respostaBusca = `Não consegui localizar resultados para "${termoDoComandoBuscar}" na planilha.`;
            }

            salvarMensagem(idContato, 'assistant', respostaBusca);
            dbSalvarConsulta(idContato, `Buscar: ${termoDoComandoBuscar}`);
            await mensagem.reply(respostaBusca);
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        // ==========================================
        // GATILHO: COMANDO SEI (MENU INTERATIVO)
        // ==========================================
        const matchSEI = textoMensagemOriginal.match(/^sei\s+([0-9./-]+)$/i);
        if (matchSEI) {
            const numeroProcesso = matchSEI[1];
            console.log(`🔎 Comando SEI detectado para ${idContato}: Processo ${numeroProcesso}`);
            
            const configGeral = lerConfiguracao();
            const numerosAutorizadosSEI = configGeral.numerosSEI || [];
            const listaAutorizadosLimpa = numerosAutorizadosSEI.map(num => String(num).replace(/\D/g, ''));
            const idContatoLimpo = String(idContato).replace(/\D/g, '');
            
            if (!ehConversaComigoMesmo && !listaAutorizadosLimpa.includes(idContatoLimpo)) {
                await mensagem.reply('🚫 Você não tem autorização para realizar consultas ao SEI.');
                try { await chat.markUnread(); } catch (e) {}
                return;
            }

            await mensagem.reply(`⏳ Acessando o SEI para listar a árvore do processo ${numeroProcesso}...\nIsso leva alguns instantes.`);
            
            try {
                const listaDocumentos = await listarDocumentosSEI(numeroProcesso);
                
                if (!listaDocumentos || listaDocumentos.length === 0) {
                    await mensagem.reply(`⚠️ A árvore carregou, mas não encontrei nenhum documento válido no processo ${numeroProcesso}.`);
                    try { await chat.markUnread(); } catch (e) {}
                    return;
                }

                // Salva o estado da sessão aguardando a resposta do usuário
                sessoesSeiEmAndamento.set(idContato, {
                    processo: numeroProcesso,
                    documentos: listaDocumentos
                });
                
                let menuTexto = `📋 *Árvore de Documentos do SEI*\nProcesso: ${numeroProcesso}\n\n`;
                listaDocumentos.forEach((doc, idx) => {
                    menuTexto += `*${idx + 1}* - ${doc}\n`;
                });
                menuTexto += `\n👉 *Digite o número* do documento que você deseja receber em PDF (ou digite 'cancelar').`;

                await mensagem.reply(menuTexto);
                dbSalvarConsulta(idContato, `SEI (Listagem): ${numeroProcesso}`);

            } catch (erroSEI) {
                console.error('Erro na listagem do SEI:', erroSEI);
                await mensagem.reply(`❌ Ocorreu um erro técnico ao acessar o SEI: ${erroSEI.message}`);
            }
            
            try { await chat.markUnread(); } catch (e) {}
            return;
        }
        // ==========================================

        const matchPregoesAno = textoMensagemOriginal.match(/^preg[õo]es\s+(\d{4})$/i);
        if (matchPregoesAno) {
            const ano = matchPregoesAno[1];
            console.log(`🔎 Comando RELATÓRIO DE PREGÕES detectado para ${idContato}: Ano ${ano}`);
            
            await mensagem.reply(`⏳ Iniciando o levantamento de todos os pregões de ${ano}. Isso pode levar alguns minutos...`);
            
            const relatorio = await gerarRelatorioPregoesAno(ano);

            if (relatorio.erro) {
                salvarMensagem(idContato, 'assistant', relatorio.erro);
                await mensagem.reply(relatorio.erro);
            } else {
                await mensagem.reply(relatorio.mensagemResumo);
                salvarMensagem(idContato, 'assistant', relatorio.mensagemResumo);
                
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                await mensagem.reply(relatorio.mensagemLista);
                salvarMensagem(idContato, 'assistant', relatorio.mensagemLista);
            }
            
            dbSalvarConsulta(idContato, `Relatório Pregões ${ano}`);
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        const numeroPregao = extrairNumeroPregao(textoMensagemOriginal);
        if (numeroPregao) {
            console.log(`🔎 Comando PE detectado para ${idContato}: ${numeroPregao}`);
            await mensagem.reply(`⏳ Consultando pregão ${numeroPregao}...`);

            const respostaPregao = await consultarItensPregao(numeroPregao);

            salvarMensagem(idContato, 'assistant', respostaPregao);
            dbSalvarConsulta(idContato, `Pregão: ${numeroPregao}`);
            await mensagem.reply(respostaPregao);
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        const termoDoComandoContrato = extrairComandoContrato(textoMensagemOriginal);
        if (termoDoComandoContrato) {
            console.log(`🔎 Comando CONTRATO detectado para ${idContato}: ${termoDoComandoContrato}`);
            await mensagem.reply(`⏳ Consultando contratos para: ${termoDoComandoContrato}`);

            const respostaContrato = await consultarContratos(termoDoComandoContrato);

            salvarMensagem(idContato, 'assistant', respostaContrato);
            dbSalvarConsulta(idContato, `Contrato: ${termoDoComandoContrato}`);
            await mensagem.reply(respostaContrato);
            try { await chat.markUnread(); } catch (erro) {}
            return;
        }

        let nomeEmpresaAtual = 'CNS';
        try {
            const configPath = path.join(process.cwd(), 'data', 'config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                if (config.empresa) nomeEmpresaAtual = config.empresa;
            }
        } catch (erro) {}

        const mensagemEhUmComando = textoEhComandoEspecial(textoMensagemOriginal, nomeEmpresaAtual);

        if (!mensagemEhUmComando) {
            const emCooldown = await contatoEstaEmCooldown(idContato);
            if (emCooldown) {
                console.log(`⏳ Contato ${idContato} está em cooldown de 30 min. Bate-papo casual ignorado.`);
                try { await chat.markUnread(); } catch (erro) {}
                return;
            }
        } else {
            console.log(`🚀 Comando cadastrado detectado de ${idContato}. Furando o cooldown!`);
        }

        try { await chat.sendStateTyping(); } catch (erro) {}

        const resultadoIA = await processarTextoComIA(
            textoMensagemOriginal,
            infoContato,
            historicoParaIA,
            precisaApresentar
        );

        const respostaFinal = respostaPossuiTextoValido(resultadoIA?.resposta)
            ? resultadoIA.resposta
            : '🤖 Eu não consegui gerar uma resposta válida agora.';

        console.log('🤖 Resposta final da Hera:', respostaFinal);

        salvarMensagem(idContato, 'assistant', respostaFinal);
        dbSalvarConsulta(idContato, resultadoIA?.termoBuscado || 'Conversa');

        await mensagem.reply(respostaFinal);

        await registrarRespostaAutomatica(idContato);

        try { await chat.markUnread(); } catch (erro) {}

    } catch (erro) {
        console.error('❌ Erro geral ao processar mensagem:', erro);
        try {
            await mensagem.reply('❌ Ocorreu um erro interno ao processar sua mensagem.');
        } catch (erroEnvio) {}
    }
}

module.exports = { processarMensagemRecebida };