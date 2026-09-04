import type { Messages } from '../index.js'

export const fr: Messages = {
  'tray.tooltip': 'G-Snap — capture d’écran',
  'tray.selectRegion': 'Sélectionner une zone',
  'tray.fullScreen': 'Plein écran vers le presse-papiers',
  'tray.openSaveFolder': 'Ouvrir le dossier d’enregistrement',
  'tray.settings': 'Paramètres...',
  'tray.version': 'Version {version}',
  'tray.quit': 'Quitter',

  'dialog.saveScreenshot': 'Enregistrer la capture',
  'dialog.chooseSaveFolder': 'Choisir le dossier d’enregistrement',
  'notice.saved': 'Enregistré',
  'notice.copied': 'Copié dans le presse-papiers',
  'notice.show': 'Afficher',
  'error.buildImage': 'Impossible de générer l’image',
  'error.writeFile': 'Impossible d’écrire le fichier. Vérifiez les permissions du dossier.',

  'action.copy': 'Copier',
  'action.save': 'Enregistrer',
  'action.saveAs': 'Enregistrer sous',
  'action.cancel': 'Annuler',

  'tool.none': 'Déplacer / redimensionner',
  'tool.pen': 'Stylo',
  'tool.marker': 'Surligneur',
  'tool.line': 'Ligne',
  'tool.arrow': 'Flèche',
  'tool.rect': 'Rectangle',
  'tool.ellipse': 'Ellipse',
  'tool.text': 'Texte',
  'tool.color': 'Couleur',
  'tool.size': 'Taille',
  'tool.undo': 'Annuler',
  'tool.redo': 'Rétablir',
  'tool.clear': 'Effacer les annotations',
  'overlay.ctrlHeld': 'Ctrl enfoncé · sera copié au relâchement',

  'settings.title': 'Paramètres de G-Snap',
  'settings.tagline': 'Capture et annotation d’écran',
  'settings.shortcutConflict': 'Conflit de raccourci',

  'settings.shortcuts': 'Raccourcis',
  'settings.shortcutsDesc': 'Cliquez dans un champ, puis appuyez sur la nouvelle combinaison.',
  'settings.selectRegion': 'Sélectionner une zone',
  'settings.selectRegionHint': 'Ouvre la surface pour choisir une zone et l’annoter.',
  'settings.fullScreen': 'Plein écran',
  'settings.fullScreenHint':
    'Copie l’écran actif directement dans le presse-papiers. Sans surface, sans fichier.',
  'settings.shortcutTaken':
    'Ce raccourci n’a pas pu être enregistré — une autre application l’utilise peut-être.',

  'settings.saving': 'Enregistrement',
  'settings.saveFolder': 'Dossier d’enregistrement',
  'settings.browse': 'Parcourir',
  'settings.fileNameTemplate': 'Modèle de nom de fichier',
  'settings.fileNameHint': 'Champs : {fields}',
  'settings.imageFormat': 'Format d’image',
  'settings.formatPng': 'PNG (sans perte)',
  'settings.formatJpg': 'JPEG (fichier plus petit)',
  'settings.jpegQuality': 'Qualité JPEG',

  'settings.behaviour': 'Comportement',
  'settings.copyOnConfirm': 'Copier dans le presse-papiers à la validation d’une sélection',
  'settings.askWhereToSave': 'Demander où enregistrer',
  'settings.askWhereToSaveHint':
    'Désactivé, les fichiers vont directement dans le dossier d’enregistrement.',
  'settings.launchAtStartup': 'Démarrer avec Windows',
  'settings.launchAtStartupHint':
    'Enregistré comme tâche planifiée, car Windows ne démarre pas automatiquement une application élevée depuis la liste de démarrage habituelle.',
  'settings.language': 'Langue',
  'settings.languageHint':
    'S’applique partout : le menu de la zone de notification, la surface et cette fenêtre.',

  'settings.annotationDefaults': 'Valeurs par défaut d’annotation',
  'settings.penColor': 'Couleur du stylo',
  'settings.thickness': 'Épaisseur',

  'settings.overlayShortcuts': 'Raccourcis de la surface',
  'settings.overlayShortcutsDesc':
    'Tout ce que comprend la surface de capture. La liste est ici plutôt que dessinée dessus : la surface est là pour montrer l’écran, rien d’autre.',
  'shortcut.drag': 'Sélectionner une zone',
  'shortcut.ctrlDrag': 'Copier dans le presse-papiers et fermer au relâchement',
  'shortcut.shiftDrag': 'Rectangle et ellipse restent carrés ; ligne et flèche s’alignent sur 45°',
  'shortcut.altDrag': 'Un carré ou un cercle qui grandit depuis le point de départ',
  'shortcut.esc': 'Effacer la sélection / fermer la surface',
  'shortcut.enter': 'Copier dans le presse-papiers',
  'shortcut.ctrlC': 'Copier dans le presse-papiers',
  'shortcut.ctrlS': 'Enregistrer',
  'shortcut.ctrlShiftS': 'Enregistrer sous',
  'shortcut.ctrlA': 'Sélectionner tout l’écran',
  'shortcut.ctrlZ': 'Annuler',
  'shortcut.tools': 'Choisir un outil (curseur, stylo, surligneur, ligne, flèche, rectangle, ellipse, texte)',

  'settings.about': 'À propos',
  'settings.openLogs': 'Ouvrir les journaux',
  'settings.restoreDefaults': 'Rétablir les valeurs par défaut',
}
