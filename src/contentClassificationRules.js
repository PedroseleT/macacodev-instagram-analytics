export const contentClassificationRules = [
  {
    quadro: 'programacao_mas_explicada_por_macacos',
    captionIncludes: ['Entendeu? Então o macacodev completou o serviço dele!']
  },
  {
    quadro: 'quando_codigo_da_errado',
    captionIncludes: ['Mais um código quebrado com sucesso']
  }
];

export const themeSignatureRegex = /tema de hoje:\s*([^\n\r]+)/gi;

export const themeAliases = {
  api: 'API',
  boolean: 'Boolean',
  for: 'For',
  while: 'While',
  'função': 'Função',
  funcao: 'Função',
  listas: 'Listas',
  lista: 'Listas',
  'if/else': 'If/Else',
  'if else': 'If/Else',
  variáveis: 'Variáveis',
  variaveis: 'Variáveis',
  'loop infinito': 'Loop infinito'
};
