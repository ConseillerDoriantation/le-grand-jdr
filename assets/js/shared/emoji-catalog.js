// Catalogue commun au chat et au mur du Bastion. Une seule source évite qu'un
// sélecteur propose moins d'émojis que l'autre.
export const CHAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

export const EMOJI_CATEGORIES = [
  { label: 'Visages', emojis: ['😀','😁','😂','🤣','😅','😊','😇','🙂','😉','😍','😘','😗','😎','🤩','🥳','😜','😝','🤪','🤔','🤨','😐','😑','😶','🙄','😴','😪','😵','🤯','😳','🥺','😢','😭','😤','😡','🤬','😱','😨','😰','😬','🤗'] },
  { label: 'Gestes', emojis: ['👍','👎','👏','🙌','🙏','💪','🤝','👀','✌️','🤞','👌','🤙','✋','👋','🤛','🤜','👊','☝️','👇','🫡'] },
  { label: 'Cœurs & symboles', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯','✨','🔥','⭐','🎉','💫','⚡','💥','❓','❗','✅'] },
  { label: 'JDR & objets', emojis: ['🎲','⚔️','🛡️','🏹','🗡️','🪓','🏰','🐉','🧙','🧝','🧟','💀','☠️','👻','😈','🗝️','💰','🍺','🧪','📜','🔮','🕯️','🗺️','💎'] },
];

export const ALL_EMOJIS = [...new Set(EMOJI_CATEGORIES.flatMap(category => category.emojis))];
