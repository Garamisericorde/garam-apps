import type { Messages } from '../index.js'

export const pt: Messages = {
  'tray.tooltip': 'G-Snap — captura de tela',
  'tray.selectRegion': 'Selecionar área',
  'tray.fullScreen': 'Tela cheia para a área de transferência',
  'tray.openSaveFolder': 'Abrir pasta de salvamento',
  'tray.settings': 'Configurações...',
  'tray.version': 'Versão {version}',
  'tray.quit': 'Sair',

  'dialog.saveScreenshot': 'Salvar captura',
  'dialog.chooseSaveFolder': 'Escolher pasta de salvamento',
  'notice.saved': 'Salvo',
  'notice.copied': 'Copiado para a área de transferência',
  'notice.show': 'Mostrar',
  'error.buildImage': 'Não foi possível gerar a imagem',
  'error.writeFile': 'Não foi possível gravar o arquivo. Verifique as permissões da pasta.',

  'action.copy': 'Copiar',
  'action.save': 'Salvar',
  'action.saveAs': 'Salvar como',
  'action.cancel': 'Cancelar',

  'tool.none': 'Mover / redimensionar',
  'tool.pen': 'Caneta',
  'tool.marker': 'Marca-texto',
  'tool.line': 'Linha',
  'tool.arrow': 'Seta',
  'tool.rect': 'Retângulo',
  'tool.ellipse': 'Elipse',
  'tool.text': 'Texto',
  'tool.color': 'Cor',
  'tool.size': 'Tamanho',
  'tool.undo': 'Desfazer',
  'tool.redo': 'Refazer',
  'tool.clear': 'Limpar anotações',
  'overlay.ctrlHeld': 'Ctrl pressionado · será copiado ao soltar',

  'settings.title': 'Configurações do G-Snap',
  'settings.tagline': 'Captura e anotação de tela',
  'settings.shortcutConflict': 'Conflito de atalho',

  'settings.shortcuts': 'Atalhos',
  'settings.shortcutsDesc': 'Clique em um campo de atalho e pressione a nova combinação.',
  'settings.selectRegion': 'Selecionar área',
  'settings.selectRegionHint': 'Abre a camada para escolher uma área e anotá-la.',
  'settings.fullScreen': 'Tela cheia',
  'settings.fullScreenHint':
    'Copia a tela ativa direto para a área de transferência. Sem camada, sem arquivo.',
  'settings.shortcutTaken':
    'Não foi possível registrar este atalho — outro aplicativo pode estar usando-o.',

  'settings.saving': 'Salvamento',
  'settings.saveFolder': 'Pasta de salvamento',
  'settings.browse': 'Procurar',
  'settings.fileNameTemplate': 'Modelo de nome de arquivo',
  'settings.fileNameHint': 'Campos: {fields}',
  'settings.imageFormat': 'Formato de imagem',
  'settings.formatPng': 'PNG (sem perdas)',
  'settings.formatJpg': 'JPEG (arquivo menor)',
  'settings.jpegQuality': 'Qualidade JPEG',

  'settings.behaviour': 'Comportamento',
  'settings.copyOnConfirm': 'Copiar para a área de transferência ao confirmar uma seleção',
  'settings.askWhereToSave': 'Perguntar onde salvar',
  'settings.askWhereToSaveHint':
    'Quando desligado, os arquivos vão direto para a pasta de salvamento.',
  'settings.launchAtStartup': 'Iniciar com o Windows',
  'settings.launchAtStartupHint':
    'Registrado como tarefa agendada, porque o Windows não inicia automaticamente um aplicativo com privilégios de administrador pela lista de inicialização comum.',
  'settings.language': 'Idioma',
  'settings.languageHint':
    'Vale em todo lugar: o menu da bandeja, a camada e esta janela.',

  'settings.annotationDefaults': 'Padrões de anotação',
  'settings.penColor': 'Cor da caneta',
  'settings.thickness': 'Espessura',

  'settings.overlayShortcuts': 'Atalhos da camada',
  'settings.overlayShortcutsDesc':
    'Tudo o que a camada de captura entende. Fica listado aqui em vez de desenhado sobre ela, que serve para mostrar a tela e nada mais.',
  'shortcut.drag': 'Selecionar uma área',
  'shortcut.ctrlDrag': 'Copiar para a área de transferência e fechar ao soltar',
  'shortcut.shiftDrag': 'Retângulo e elipse ficam quadrados; linha e seta travam em 45°',
  'shortcut.altDrag': 'Um quadrado ou círculo que cresce a partir do ponto inicial',
  'shortcut.esc': 'Limpar a seleção / fechar a camada',
  'shortcut.enter': 'Copiar para a área de transferência',
  'shortcut.ctrlC': 'Copiar para a área de transferência',
  'shortcut.ctrlS': 'Salvar',
  'shortcut.ctrlShiftS': 'Salvar como',
  'shortcut.ctrlA': 'Selecionar a tela inteira',
  'shortcut.ctrlZ': 'Desfazer',
  'shortcut.tools': 'Escolher ferramenta (cursor, caneta, marca-texto, linha, seta, retângulo, elipse, texto)',

  'settings.about': 'Sobre',
  'settings.openLogs': 'Abrir registros',
  'settings.restoreDefaults': 'Restaurar padrões',
}
