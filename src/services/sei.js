const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
require('dotenv').config();

// Função auxiliar para fazer o login e achar o processo
async function acessarProcessoSEI(numeroProcesso, page, context) {
    await page.goto('https://sei.saude.gov.br/sip/login.php?sigla_orgao_sistema=MS&sigla_sistema=SEI&infra_url=L3NlaS8=');
    
    await page.waitForSelector('#txtUsuario');
    await page.fill('#txtUsuario', process.env.SEI_USER || '5286');
    await page.waitForTimeout(1500);

    const campoSenhaVisivel = page.locator('input.masked:not([type="password"])');
    await campoSenhaVisivel.click();
    await page.waitForTimeout(500);
    await campoSenhaVisivel.pressSequentially(process.env.SEI_PASS || 'Gênesis01:01', { delay: 150 });
    await page.waitForTimeout(1000);

    await page.selectOption('#selOrgao', '66'); // INCA
    await page.click('#sbmAcessar');

    await page.waitForLoadState('networkidle').catch(() => {}); 
    await page.waitForTimeout(3000); 

    let campoPesquisa = null;
    let frameNavSuperior = null;

    const framesIniciais = page.frames();
    for (const f of framesIniciais) {
        const elemento = await f.$('input[name^="txtPesquisa"]').catch(() => null);
        if (elemento) {
            campoPesquisa = elemento;
            frameNavSuperior = f;
            break;
        }
    }

    if (!campoPesquisa || !frameNavSuperior) {
        throw new Error('Não foi possível localizar a barra de pesquisa superior.');
    }

    await campoPesquisa.click();
    await frameNavSuperior.fill('input[name^="txtPesquisa"]', numeroProcesso);
    await page.waitForTimeout(500);
    await frameNavSuperior.press('input[name^="txtPesquisa"]', 'Enter');

    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(6000); 

    let escopoFinalArvore = null;
    const todosOsFrames = page.frames();
    for (const f of todosOsFrames) {
        if (f.name() === 'ifrArvore') {
            escopoFinalArvore = f;
            break;
        }
    }

    if (!escopoFinalArvore) {
        escopoFinalArvore = page.frames().find(f => f.url().toLowerCase().includes('arvore_visualizar'));
    }

    if (!escopoFinalArvore) {
        throw new Error('Não foi possível isolar o componente interno da árvore.');
    }

    return escopoFinalArvore;
}

// Lógica de expansão trazida 100% do seu index.js
async function expandirTodasPastas(escopoFinalArvore, page) {
    const seletorUniversal = 'a.infraArvoreNo, span.infraArvoreNo a, a[id^="ancora"]';
    await escopoFinalArvore.waitForSelector(seletorUniversal, { timeout: 10000 }).catch(() => {});

    let nosFechados = await escopoFinalArvore.$$('a[title^="Expandir"], img[src*="mais"], a[href*="infraArvoreExpandir"]');
    
    if (nosFechados.length > 0) {
        for (let i = 0; i < nosFechados.length; i++) {
            try {
                const nosAtualizados = await escopoFinalArvore.$$('a[title^="Expandir"], img[src*="mais"], a[href*="infraArvoreExpandir"]');
                if (nosAtualizados[i]) {
                    await nosAtualizados[i].click();
                    
                    let carregado = false;
                    let tentativasEspera = 0;
                    
                    while (!carregado && tentativasEspera < 20) { 
                        await page.waitForTimeout(500);
                        tentativasEspera++;
                        const textoArvoreHtml = await escopoFinalArvore.content();
                        if (!textoArvoreHtml.includes('Aguarde...')) {
                            carregado = true;
                        }
                    }
                }
            } catch (e) {}
        }
        await page.waitForTimeout(3000); 
    }
}

// 1. FUNÇÃO QUE LISTA OS DOCUMENTOS
async function listarDocumentosSEI(numeroProcesso) {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        const escopoFinalArvore = await acessarProcessoSEI(numeroProcesso, page, context);
        
        await expandirTodasPastas(escopoFinalArvore, page);

        const seletorUniversal = 'a.infraArvoreNo, span.infraArvoreNo a, a[id^="ancora"]';
        const linksDocumentos = await escopoFinalArvore.$$(seletorUniversal);
        const listaNomesDocumentos = [];

        for (const link of linksDocumentos) {
            const id = await link.getAttribute('id') || '';
            const texto = await link.innerText() || '';
            const textoLimpo = texto.trim();
            
            if (textoLimpo.length > 0 && textoLimpo !== 'Aguarde...' && !id.includes('ancVoltar') && !id.includes('ancIcones') && !id.includes('ancAnterior') && !id.includes('ancProximo') && !id.includes('ancAbrir') && !id.includes('ancFechar')) {
                listaNomesDocumentos.push(textoLimpo);
            }
        }

        await browser.close();
        return listaNomesDocumentos;
    } catch (error) {
        await browser.close();
        throw error;
    }
}

// 2. FUNÇÃO QUE EXTRAI UM DOCUMENTO ESPECÍFICO USANDO A IMPRESSORA NATIVA DO SEI
async function extrairDocumentoSEIPdf(numeroProcesso, nomeDocumentoAlvo) {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        const escopoFinalArvore = await acessarProcessoSEI(numeroProcesso, page, context);
        const seletorUniversal = 'a.infraArvoreNo, span.infraArvoreNo a, a[id^="ancora"]';

        await expandirTodasPastas(escopoFinalArvore, page);

        const linksAtuais = await escopoFinalArvore.$$(seletorUniversal);
        let elementoAlvoFresco = null;

        for (const link of linksAtuais) {
            const textoLink = await link.innerText() || '';
            if (textoLink.trim() === nomeDocumentoAlvo) {
                elementoAlvoFresco = link;
                break;
            }
        }

        if (!elementoAlvoFresco) throw new Error(`O documento "${nomeDocumentoAlvo}" não foi localizado na árvore expandida.`);

        // Clica no documento para abrir os frames da direita
        await elementoAlvoFresco.click();
        
        // Aguarda os frames da direita (menu de ícones e o documento) carregarem
        await page.waitForTimeout(3000); 

        let urlImpressao = null;

        // TENTATIVA 1: Caçar o botão oficial de "Imprimir" do SEI (ação documento_imprimir_web)
        for (const f of page.frames()) {
            try {
                const btnImprimir = await f.$('a[href*="documento_imprimir_web"]');
                if (btnImprimir) {
                    urlImpressao = await f.evaluate(el => el.href, btnImprimir);
                    break;
                }
            } catch (e) {}
        }

        // TENTATIVA 2: Fallback (se a impressora não existir, pega a URL do próprio frame do documento)
        if (!urlImpressao) {
            for (const f of page.frames()) {
                const nomeFrame = f.name();
                const urlFrame = f.url().toLowerCase();
                if (nomeFrame === 'ifrConteudoVisualizacao' || urlFrame.includes('documento_visualizar')) {
                    urlImpressao = f.url();
                    break;
                }
            }
        }

        if (!urlImpressao) {
             throw new Error('Não consegui localizar o link de impressão ou de visualização interna do documento.');
        }

        // Abre uma nova aba cirúrgica invisível com o link de impressão
        const pdfPage = await context.newPage();
        await pdfPage.goto(urlImpressao, { waitUntil: 'domcontentloaded' });
        
        // Pausa crucial para dar tempo do brasão, assinaturas e códigos de barra renderizarem na tela
        await pdfPage.waitForTimeout(2000);

        // Gera o PDF nativo acionando o mesmo motor que o Chrome/Edge usa ao clicar "Salvar como PDF"
        const caminhoPdf = path.join(os.tmpdir(), `SEI_${Date.now()}.pdf`);
        await pdfPage.pdf({ 
            path: caminhoPdf, 
            format: 'A4', 
            printBackground: true, // Garante que cores de fundo e brasões oficiais apareçam
            margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' } 
        });

        await browser.close();
        return caminhoPdf;

    } catch (error) {
        await browser.close();
        throw error;
    }
}

module.exports = { listarDocumentosSEI, extrairDocumentoSEIPdf };