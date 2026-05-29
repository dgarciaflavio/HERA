const xlsx = require('xlsx');
const { configEquipePath, planilhaPath } = require('../config/paths');

const limparRef = (texto) => {
    if (!texto) return '';
    return String(texto)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();
};

function paraNumero(valor, padrao = 0) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
        return padrao;
    }

    const texto = String(valor).trim();

    if (/^-?\d+([.,]\d+)?$/.test(texto)) {
        const numero = Number(texto.replace(',', '.'));
        return Number.isFinite(numero) ? numero : padrao;
    }

    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : padrao;
}

function calcularSugestaoAE(cmm12) {
    return Math.ceil(paraNumero(cmm12, 0) * 6);
}

function converterDataExcelOuTexto(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
        return null;
    }

    if (typeof valor === 'number') {
        const data = new Date((valor - 25569) * 86400 * 1000);
        return isNaN(data.getTime()) ? null : data;
    }

    const texto = String(valor).trim();

    const matchBr = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (matchBr) {
        const [, dia, mes, ano] = matchBr;
        const data = new Date(`${ano}-${mes}-${dia}T00:00:00`);
        return isNaN(data.getTime()) ? null : data;
    }

    const data = new Date(texto);
    return isNaN(data.getTime()) ? null : data;
}

function formatarDataBR(data) {
    if (!(data instanceof Date) || isNaN(data.getTime())) {
        return 'N/A';
    }

    return data.toLocaleDateString('pt-BR');
}

function possuiAERelacionada(linha) {
    return Object.keys(linha).some(chave => {
        const chaveNormalizada = String(chave || '').trim().toUpperCase();

        if (!chaveNormalizada.startsWith('AE')) {
            return false;
        }

        if (chaveNormalizada.includes('QTDE') || chaveNormalizada.includes('EMPENHAR')) {
            return false;
        }

        const valor = linha[chave];
        return valor !== undefined && valor !== null && String(valor).trim() !== '';
    });
}

// ADICIONADO O PARÂMETRO isManual COM VALOR PADRÃO false
async function dispararAlertasDeAta(client, isManual = false) {
    try {
        console.log('\n==================================================');
        console.log('🚀 INICIANDO VARREDURA DE ATAS PELA HERA...');

        // --- TRAVA DE FINAL DE SEMANA (SÓ PARA DISPAROS AUTOMÁTICOS) ---
        const dataAtual = new Date();
        const diaDaSemana = dataAtual.getDay(); // 0 = Domingo, 1 = Segunda, ... 6 = Sábado
        
        if (!isManual && (diaDaSemana === 0 || diaDaSemana === 6)) {
            console.log('⛔ Operação automática interrompida: Hoje é final de semana (sábado ou domingo).');
            console.log('==================================================\n');
            return '⛔ Disparo automático cancelado: A Hera está configurada para não enviar alertas no final de semana.';
        }
        // --------------------------------

        const isTeste = process.env.MODO_TESTE === 'true';
        const numeroFlavio = process.env.MEU_NUMERO;

        if (isTeste) {
            console.log('⚠️ AVISO: MODO TESTE ATIVADO. Mensagens redirecionadas para o admin.');
        }

        const wbConfig = xlsx.readFile(configEquipePath);

        const abaCadNome = wbConfig.SheetNames.find(n => n.trim() === 'Cad_Alerta');
        const abaConfigNome = wbConfig.SheetNames.find(n => n.trim() === 'Config_Equipe');

        if (!abaCadNome || !abaConfigNome) {
            console.log('❌ ERRO CRÍTICO: Não encontrei as guias "Config_Equipe" ou "Cad_Alerta".');
            return '❌ Erro: Guias não encontradas no arquivo Config_Equipe.xlsx.';
        }

        const cadDados = xlsx.utils.sheet_to_json(wbConfig.Sheets[abaCadNome]);
        const telefones = {};

        cadDados.forEach(linha => {
            const cols = Object.keys(linha);
            const nomeRaw = String(linha[cols[0]] || '').trim();
            const nomeLimpo = limparRef(nomeRaw);
            const telRaw = String(linha[cols[1]] || '').replace(/\D/g, '');

            if (nomeLimpo && telRaw.length >= 10) {
                telefones[nomeLimpo] = {
                    nomeReal: nomeRaw,
                    numero: `${telRaw}@c.us`
                };
            }
        });

        const configDados = xlsx.utils.sheet_to_json(wbConfig.Sheets[abaConfigNome]);
        const regras = [];
        const supervisores = [];

        configDados.forEach(linha => {
            const cols = Object.keys(linha);
            if (cols.length < 2) return;

            const referenciaRaw = String(linha[cols[0]] || '').trim();
            const referenciaLimpa = limparRef(referenciaRaw);

            const nomeResponsavelRaw = String(linha[cols[1]] || '').trim();
            const nomeResponsavelLimpo = limparRef(nomeResponsavelRaw);

            const contatoEncontrado = telefones[nomeResponsavelLimpo];

            if (!contatoEncontrado && referenciaLimpa !== '') {
                console.log(`⚠️ ALERTA: Telefone não encontrado para "${nomeResponsavelRaw}". Verifique a aba Cad_Alerta.`);
                return;
            }

            if (referenciaLimpa === 'TODASASFAMILIAS') {
                supervisores.push({
                    nome: contatoEncontrado.nomeReal,
                    telefone: contatoEncontrado.numero
                });
            } else if (referenciaLimpa !== 'TESTES' && referenciaLimpa !== '') {
                regras.push({
                    ref: referenciaLimpa,
                    nome: contatoEncontrado.nomeReal,
                    telefone: contatoEncontrado.numero,
                    refOriginal: referenciaRaw
                });
            }
        });

        console.log(`📋 MAPEAMENTO: ${Object.keys(telefones).length} Telefones, ${regras.length} Regras e ${supervisores.length} Supervisores.`);
        console.log(`🔍 Exemplo de Regras Carregadas:`, regras.slice(0, 3).map(r => `${r.refOriginal} -> ${r.ref}`));
        console.log('--------------------------------------------------\n');

        const wbDados = xlsx.readFile(planilhaPath);
        const dados = xlsx.utils.sheet_to_json(wbDados.Sheets[wbDados.SheetNames[0]], { defval: '', range: 1 });

        const alertasPorTelefone = {};
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const anoAtual = hoje.getFullYear();

        let itensProcessados = 0;

        dados.forEach(linha => {
            const itemOriginal = String(linha['Item'] || '').trim();
            if (!itemOriginal) return;

            // Busca todas as linhas referentes a este item na grade
            const linhasDoMesmoItem = dados.filter(l => String(l['Item'] || '').trim() === itemOriginal);

            const saldoEmDias = paraNumero(linha['Saldo em Dias'], 0);
            const cmm12 = paraNumero(linha['CMM12'], 0);
            const vencAtaRaw = linha['Venc.Ata'];

            // Regra: Não possui AE em nenhuma das linhas
            const naoTemAE = !linhasDoMesmoItem.some(l => possuiAERelacionada(l));

            // Avaliar Empenhos de forma consolidada no item
            let temAnoAtual = false;
            let temAnoAnterior = false;
            const empenhosAntigos = new Set();

            linhasDoMesmoItem.forEach(l => {
                const numEmpenho = String(l['Num.Empenho'] || '').trim();
                const fornecedor = String(l['Fornecedor Empenho'] || '').trim();
                
                if (numEmpenho && numEmpenho !== '0' && numEmpenho.toLowerCase() !== 'n/a') {
                    const matchAno = numEmpenho.match(/^(\d{4})/);
                    if (matchAno) {
                        const anoEmpenho = parseInt(matchAno[1], 10);
                        if (anoEmpenho === anoAtual) {
                            temAnoAtual = true;
                        } else if (anoEmpenho === anoAtual - 1) {
                            temAnoAnterior = true;
                        } else if (anoEmpenho < anoAtual - 1) {
                            empenhosAntigos.add(`${numEmpenho} (Fornecedor: ${fornecedor || 'Não informado'})`);
                        }
                    }
                }
            });

            // Consideramos "Sem Empenho" apenas se não tiver do ano atual nem do ano anterior
            const naoTemEmpenhoValido = !temAnoAtual && !temAnoAnterior;

            const dataAta = converterDataExcelOuTexto(vencAtaRaw);
            const ataValida = (dataAta instanceof Date && !isNaN(dataAta.getTime()) && dataAta >= hoje);

            // GATILHOS DA HERA
            const precisaReposicao = (saldoEmDias <= 70 && cmm12 > 0 && ataValida && naoTemAE && naoTemEmpenhoValido);
            const sugestaoCancelamentoDuplo = (temAnoAtual && temAnoAnterior);
            const sugestaoCancelamentoAntigo = (empenhosAntigos.size > 0);

            if (precisaReposicao || sugestaoCancelamentoDuplo || sugestaoCancelamentoAntigo) {
                const chaveColA = Object.keys(linha)[0];
                const valorColA = limparRef(linha[chaveColA]);

                const itemLimpo = limparRef(itemOriginal);
                const familiaOriginal = String(linha['Família'] || '').trim();
                const familiaLimpa = limparRef(familiaOriginal);

                const descricao = String(linha['Descrição'] || '').trim();
                const saldoAtual = String(linha['Saldo Atual'] || '').trim() || '0';
                const dataFormatada = formatarDataBR(dataAta);

                let blocoMensagem = `\n📦 *Item:* ${itemOriginal} - ${descricao}\n`;

                if (precisaReposicao) {
                    const sugestaoAE = calcularSugestaoAE(cmm12);
                    blocoMensagem += `📊 *Saldo Atual:* ${saldoAtual} | *Saldo em Dias:* ${saldoEmDias}\n`;
                    blocoMensagem += `📈 *CMM12:* ${cmm12} | *Venc. Ata:* ${dataFormatada}\n`;
                    blocoMensagem += `💡 *Sugestão de AE:* ${sugestaoAE} und (P/ 6 meses)\n`;
                } else {
                    blocoMensagem += `📊 *Saldo Atual:* ${saldoAtual} | *Venc. Ata:* ${dataFormatada}\n`;
                }

                if (sugestaoCancelamentoDuplo) {
                    blocoMensagem += `⚠️ *Aviso de Empenho:* Constam empenhos de ${anoAtual} e ${anoAtual - 1}. Sugere-se avaliar o cancelamento do saldo do empenho de ${anoAtual - 1}.\n`;
                }

                if (sugestaoCancelamentoAntigo) {
                    blocoMensagem += `⚠️ *Aviso de Empenho Antigo:* Há empenhos antigos. Sugere-se verificar para cancelamento de saldo:\n`;
                    empenhosAntigos.forEach(emp => {
                        blocoMensagem += `   - ${emp}\n`;
                    });
                }

                console.log(`🔍 Analisando: [${itemOriginal}] | Família: [${familiaOriginal}] -> Buscando na memória por Item [${itemLimpo}] ou Família [${familiaLimpa}]`);

                if (valorColA === 'FAR') {
                    const donoFAR = regras.find(r => r.ref === 'FAR');

                    if (donoFAR) {
                        console.log(`   ✅ Destino: ${donoFAR.nome} (Regra: FAR)`);

                        if (!alertasPorTelefone[donoFAR.telefone]) {
                            alertasPorTelefone[donoFAR.telefone] = {
                                nome: donoFAR.nome,
                                itens: new Set()
                            };
                        }

                        alertasPorTelefone[donoFAR.telefone].itens.add(blocoMensagem);
                        itensProcessados++;
                    } else {
                        console.log(`   ❌ Erro: Cadastre 'FAR' na aba Config_Equipe para a Rafaelle!`);
                    }
                } else {
                    const dono = regras.find(r => r.ref === itemLimpo) || regras.find(r => r.ref === familiaLimpa);

                    if (dono) {
                        console.log(`   ✅ Destino: ${dono.nome} (Regra Encontrada: ${dono.refOriginal})`);

                        if (!alertasPorTelefone[dono.telefone]) {
                            alertasPorTelefone[dono.telefone] = {
                                nome: dono.nome,
                                itens: new Set()
                            };
                        }

                        alertasPorTelefone[dono.telefone].itens.add(blocoMensagem);
                        itensProcessados++;
                    } else {
                        console.log(`   ⚠️ Sem Dono: Nenhuma regra bate com o Item [${itemLimpo}] ou Família [${familiaLimpa}]`);
                    }

                    supervisores.forEach(sup => {
                        if (!alertasPorTelefone[sup.telefone]) {
                            alertasPorTelefone[sup.telefone] = {
                                nome: sup.nome,
                                itens: new Set()
                            };
                        }

                        alertasPorTelefone[sup.telefone].itens.add(blocoMensagem);
                    });
                }
            }
        });

        console.log(`\n📦 Resumo: ${itensProcessados} itens processados e atribuídos a algum responsável.`);
        console.log('\n📲 INICIANDO DISPAROS NO WHATSAPP...');

        let enviosFeitos = 0;

        for (const telefoneDestino in alertasPorTelefone) {
            const dadosDestino = alertasPorTelefone[telefoneDestino];

            if (dadosDestino.itens.size === 0) {
                continue;
            }

            let textoFinal =
                `Olá, ${dadosDestino.nome}! 🤖 Aqui é a Hera, assistente virtual da Supervisão.\n\n` +
                `Identifiquei itens sob sua responsabilidade precisando de análise (*SALDO EM DIAS <= 70*, *ATA VÁLIDA*, *SEM EMPENHO* e *SEM AE*) ou com pendências de empenhos antigos e/ou sobrepostos.\n` +
                `Segue abaixo a relação:\n`;

            textoFinal += Array.from(dadosDestino.itens).join('');
            textoFinal += `\n📌 *Nota:* A quantidade sugerida é apenas um cálculo base (CMM12 x 6 meses). Por favor, avalie a necessidade real de empenho.`;

            let numeroFinal = telefoneDestino;

            if (isTeste) {
                textoFinal =
                    `⚠️ *[MODO TESTE LIGADO]*\n` +
                    `_A mensagem abaixo seria enviada para ${dadosDestino.nome} (${telefoneDestino}):_\n\n` +
                    textoFinal;

                numeroFinal = numeroFlavio;
            }

            try {
                console.log(`   Enviando mensagem para ${dadosDestino.nome}...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                await client.sendMessage(numeroFinal, textoFinal);
                console.log('   ✅ Sucesso!');
                enviosFeitos++;
            } catch (err) {
                console.log(`   ❌ Falha ao enviar para ${dadosDestino.nome}. Erro: ${err.message}`);
            }
        }

        console.log(`\n🎯 FINALIZADO: ${enviosFeitos} mensagens enviadas!`);
        console.log('==================================================\n');

        return `✅ Verificação concluída! Relatórios processados com sucesso. Consulte o terminal para logs detalhados.`;
    } catch (erro) {
        console.error('❌ Ocorreu um erro geral no bloco de notificações:', erro);
        return '❌ Ocorreu um erro ao tentar processar as notificações de ata.';
    }
}

module.exports = { dispararAlertasDeAta };