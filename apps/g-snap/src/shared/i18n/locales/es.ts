import type { Messages } from '../index.js'

export const es: Messages = {
  'tray.tooltip': 'G-Snap — captura de pantalla',
  'tray.selectRegion': 'Seleccionar área',
  'tray.fullScreen': 'Pantalla completa al portapapeles',
  'tray.openSaveFolder': 'Abrir carpeta de guardado',
  'tray.settings': 'Configuración...',
  'tray.version': 'Versión {version}',
  'tray.quit': 'Salir',

  'dialog.saveScreenshot': 'Guardar captura',
  'dialog.chooseSaveFolder': 'Elegir carpeta de guardado',
  'notice.saved': 'Guardado',
  'notice.copied': 'Copiado al portapapeles',
  'notice.show': 'Mostrar',
  'error.buildImage': 'No se pudo generar la imagen',
  'error.writeFile': 'No se pudo escribir el archivo. Comprueba los permisos de la carpeta.',

  'action.copy': 'Copiar',
  'action.save': 'Guardar',
  'action.saveAs': 'Guardar como',
  'action.cancel': 'Cancelar',

  'tool.none': 'Mover / redimensionar',
  'tool.pen': 'Lápiz',
  'tool.marker': 'Marcador',
  'tool.line': 'Línea',
  'tool.arrow': 'Flecha',
  'tool.rect': 'Rectángulo',
  'tool.ellipse': 'Elipse',
  'tool.text': 'Texto',
  'tool.color': 'Color',
  'tool.size': 'Tamaño',
  'tool.undo': 'Deshacer',
  'tool.redo': 'Rehacer',
  'tool.clear': 'Borrar anotaciones',
  'overlay.ctrlHeld': 'Ctrl pulsado · se copiará al soltar',

  'settings.title': 'Configuración de G-Snap',
  'settings.tagline': 'Captura y anotación de pantalla',
  'settings.shortcutConflict': 'Conflicto de atajo',

  'settings.shortcuts': 'Atajos',
  'settings.shortcutsDesc': 'Haz clic en un campo de atajo y pulsa la nueva combinación.',
  'settings.selectRegion': 'Seleccionar área',
  'settings.selectRegionHint': 'Abre la capa para elegir un área y anotarla.',
  'settings.fullScreen': 'Pantalla completa',
  'settings.fullScreenHint':
    'Copia la pantalla activa directamente al portapapeles. Sin capa, sin archivo.',
  'settings.shortcutTaken':
    'No se pudo registrar este atajo — puede que otra aplicación lo esté usando.',

  'settings.saving': 'Guardado',
  'settings.saveFolder': 'Carpeta de guardado',
  'settings.browse': 'Examinar',
  'settings.fileNameTemplate': 'Plantilla de nombre de archivo',
  'settings.fileNameHint': 'Campos: {fields}',
  'settings.imageFormat': 'Formato de imagen',
  'settings.formatPng': 'PNG (sin pérdida)',
  'settings.formatJpg': 'JPEG (archivo más pequeño)',
  'settings.jpegQuality': 'Calidad JPEG',

  'settings.behaviour': 'Comportamiento',
  'settings.copyOnConfirm': 'Copiar al portapapeles al confirmar una selección',
  'settings.askWhereToSave': 'Preguntar dónde guardar',
  'settings.askWhereToSaveHint':
    'Si está desactivado, los archivos van directos a la carpeta de guardado.',
  'settings.launchAtStartup': 'Iniciar con Windows',
  'settings.launchAtStartupHint':
    'Se registra como tarea programada, porque Windows no inicia automáticamente una aplicación con permisos de administrador desde la lista de inicio habitual.',
  'settings.language': 'Idioma',
  'settings.languageHint': 'Se aplica en todas partes: el menú de la bandeja, la capa y esta ventana.',

  'settings.annotationDefaults': 'Valores por defecto de anotación',
  'settings.penColor': 'Color del lápiz',
  'settings.thickness': 'Grosor',

  'settings.overlayShortcuts': 'Atajos de la capa',
  'settings.overlayShortcutsDesc':
    'Todo lo que entiende la capa de captura. Se lista aquí en lugar de dibujarse sobre ella, que está para mostrar la pantalla y nada más.',
  'shortcut.drag': 'Seleccionar un área',
  'shortcut.ctrlDrag': 'Copiar al portapapeles y cerrar al soltar',
  'shortcut.shiftDrag': 'Rectángulo y elipse se mantienen cuadrados; línea y flecha se ajustan a 45°',
  'shortcut.altDrag': 'Un cuadrado o círculo que crece desde el punto de inicio',
  'shortcut.esc': 'Borrar la selección / cerrar la capa',
  'shortcut.enter': 'Copiar al portapapeles',
  'shortcut.ctrlC': 'Copiar al portapapeles',
  'shortcut.ctrlS': 'Guardar',
  'shortcut.ctrlShiftS': 'Guardar como',
  'shortcut.ctrlA': 'Seleccionar toda la pantalla',
  'shortcut.ctrlZ': 'Deshacer',
  'shortcut.tools': 'Elegir herramienta (cursor, lápiz, marcador, línea, flecha, rectángulo, elipse, texto)',

  'settings.about': 'Acerca de',
  'settings.openLogs': 'Abrir registros',
  'settings.restoreDefaults': 'Restaurar valores por defecto',
}
