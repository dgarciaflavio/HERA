const path = require('path');
const raiz = process.cwd();

module.exports = {
    raiz,
    dataDir: path.join(raiz, 'data'),
    contratoDir: path.join(raiz, 'data', 'contrato'),
    configPath: path.join(raiz, 'data', 'config.json'),
    planilhaPath: path.join(raiz, 'data', 'planilha.xlsx'),
    configEquipePath: path.join(raiz, 'data', 'Config_Equipe.xlsx'),
    bancoConversasPath: path.join(raiz, 'data', 'banco_conversas.db'),
    catalogoSidecPath: path.join(raiz, 'data', 'catalogo_sidec.db'),
    pcaCadastroPath: path.join(raiz, 'data', 'pca_cadastro.json'),
    pcaUnificadoPath: path.join(raiz, 'data', 'PCA', 'unificacao.xlsx'),
    pncpUnificadoPath: path.join(raiz, 'data', 'PNCP', 'unificado.xlsx'),
    pregoesCachePath: path.join(raiz, 'data', 'pregoes_cache.db')
};