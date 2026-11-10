/* UI language (English / Français) for the TV and phones.
 *
 * The room's language is a TV lobby setting (state.settings.lang). Templates stay in
 * English; when French is on, a MutationObserver swaps known UI text (exact strings
 * and {n}-style patterns) in text nodes and placeholder/aria/title attributes as they
 * appear. Player-written answers and prompts are never in the dictionary, so they're
 * left alone. Prompt games draw the French content pack (games/library.js, lang).
 * AGPLv3 — see LICENSE.
 */
'use strict';

(function () {
  /** @type {Record<string, string>} exact UI strings (trimmed) */
  const FR = {
    // join + lobby (phone)
    'Join a room': 'Rejoindre une partie', 'Room code': 'Code de la partie', 'Nickname': 'Surnom', 'Your name': 'Ton nom',
    'Your profile picture': 'Ta photo de profil', '🧑 Make your character': '🧑 Crée ton personnage', '🐾 Pick an animal': '🐾 Choisis un animal',
    'Join': 'Rejoindre', 'Leave': 'Quitter', "You're in!": "T'es dedans !", '🧑 Edit my character': '🧑 Modifier mon personnage',
    'Save my character': 'Enregistrer mon personnage', 'Watch the TV — the host is picking a game.': "Regarde la télé — l'hôte choisit un jeu.",
    'Watch the TV for the next game.': 'Regarde la télé pour le prochain jeu.', 'Game over': 'Partie terminée', 'Room closed': 'Partie fermée',
    'The host ended the room.': "L'hôte a fermé la partie.", 'You were removed from the room': 'Tu as été retiré de la partie',
    'Join again': 'Rejoindre à nouveau', 'Join another': 'Rejoindre une autre partie',
    'Lost connection to the server — reconnecting…': 'Connexion perdue — reconnexion…', 'Connecting…': 'Connexion…',
    // generic in-game (phone)
    'Eyes on the TV 📺': 'Les yeux sur la télé 📺', 'Waiting for the other players…': 'On attend les autres joueurs…',
    'Waiting for the slowpokes… send some taunts below 👇': 'On attend les tortues… envoie des taquineries 👇',
    'Send it': 'Envoyer', 'Submit': 'Envoyer', 'Done': 'Terminé', 'Lock it in': 'Verrouiller', 'Locked in': 'Verrouillé',
    'Vote cast': 'Vote enregistré', 'Vote in': 'Vote enregistré', 'Ready': 'Prêt', 'Clue sent': 'Indice envoyé',
    'Lie submitted': 'Mensonge envoyé', 'Passed it on': 'Transmis', 'Card played': 'Carte jouée', 'Card played ✓': 'Carte jouée ✓',
    'Guess locked': 'Réponse verrouillée', 'Guess locked in ✓': 'Réponse verrouillée ✓', 'Answer + bet locked': 'Réponse + pari verrouillés',
    'Your answer…': 'Ta réponse…', 'Your funniest answer…': 'Ta réponse la plus drôle…', 'Your convincing lie…': 'Ton mensonge convaincant…',
    'Describe it…': 'Décris-le…', 'One-word clue': 'Indice en un mot', 'Which is funnier?': 'Laquelle est la plus drôle ?',
    'Which one is the truth?': 'Laquelle est la vérité ?', 'Pick a card:': 'Choisis une carte :', 'Pick the winner:': 'Choisis le gagnant :',
    "You're the Card Czar": "C'est toi le Tsar des cartes", 'Sit tight — everyone else is picking a card.': 'Patience — les autres choisissent une carte.',
    'Round winner': 'Gagnant de la manche', 'Make up a fake answer to fool everyone:': 'Invente une fausse réponse pour berner tout le monde :',
    "That\\'s the real answer! Write a convincing fake instead.": "C'est la vraie réponse ! Écris plutôt un faux convaincant.",
    "That's the real answer! Write a convincing fake instead.": "C'est la vraie réponse ! Écris plutôt un faux convaincant.",
    'Say what you think most people will say.': 'Dis ce que la plupart des gens vont dire.', 'How many others will say the same?': 'Combien diront la même chose ?',
    'Write something to draw': 'Écris quelque chose à dessiner', 'What is this?': "Qu'est-ce que c'est ?", 'Draw:': 'Dessine :',
    'Best doodle?': 'Le meilleur dessin ?', 'Favourite step? ❤': 'Ton étape préférée ? ❤', 'Favourite picked ❤': 'Choix enregistré ❤',
    'The chains are being revealed…': 'On dévoile les chaînes…', 'Everyone else is picking a favourite step…': 'Les autres choisissent leur étape préférée…',
    'Nothing to vote on': 'Rien à voter', "Who's the imposter?": "Qui est l'imposteur ?", 'You are the IMPOSTER': "Tu es l'IMPOSTEUR",
    'Secret word:': 'Mot secret :', 'You were caught! Guess the word to steal points:': 'Démasqué ! Devine le mot pour voler des points :',
    'Blend in! Give a clue that fits the category.': 'Fonds-toi dans la masse ! Donne un indice qui colle à la catégorie.',
    'Give a one-word clue — not too obvious, the imposter is listening!': "Donne un indice en un mot — pas trop évident, l'imposteur écoute !",
    'True thing #1': 'Vérité nº 1', 'True thing #2': 'Vérité nº 2', 'Your lie 🤥': 'Ton mensonge 🤥', "It's about you!": "C'est à propos de toi !",
    'Keep a straight face 😐': 'Garde ton sérieux 😐', 'Category round!': 'Manche catégorie !', 'Category round': 'Manche catégorie',
    "You're in last place 😅": 'Tu es en dernière place 😅', 'So YOU pick the next category:': 'Alors c\'est TOI qui choisis la catégorie :',
    'Nice! ✓': 'Bravo ! ✓', 'Nope ✗': 'Raté ✗', 'You found it! ✓': 'Trouvé ! ✓', 'Fooled ✗': 'Berné ✗', 'All alone ✗': 'Tout seul ✗',
    'Dead heat!': 'Égalité parfaite !', 'Ouch. 💀': 'Aïe. 💀', 'You won the matchup! 🏆': 'Tu as gagné le duel ! 🏆',
    'With the crowd! +100': 'Avec la foule ! +100', 'Against the grain ✗': 'À contre-courant ✗', 'No vote': 'Pas de vote', 'No guess': 'Pas de réponse',
    'Spotted it! +100': 'Repéré ! +100',
    'Place a side bet while everyone votes:': 'Fais un pari pendant que les autres votent :',
    "🤞 I'll win · +100 / −50": '🤞 Je vais gagner · +100 / −50', '🔥 Landslide (75%+) · +250 / −100': '🔥 Raz-de-marée (75 %+) · +250 / −100', 'Too early!': 'Trop tôt !', 'TAP!': 'TAPE !', 'TAP! TAP! TAP!': 'TAPE ! TAPE ! TAPE !', 'WAIT…': 'ATTENDS…',
    'GO!': 'GO !', 'HOLD TO ROAST': 'MAINTIENS POUR GRILLER', 'Let go at 3.0 s': 'Lâche à 3,0 s', 'Roasted': 'Grillé', 'Tapped': 'Tapé',
    'How many fireflies?': 'Combien de lucioles ?', 'Count the fireflies!': 'Compte les lucioles !', 'Get ready…': 'Prépare-toi…',
    'What do we play next?': 'On joue à quoi ensuite ?', 'Next up:': 'Prochain jeu :',
    '🎲 Double Down? ×2 if right · −300 if wrong (once per game)': '🎲 Quitte ou double ? ×2 si juste · −300 si faux (une fois par partie)',
    '🎲 Double Down? ×2 if you place · −200 if not (once per game)': '🎲 Quitte ou double ? ×2 si tu es classé · −200 sinon (une fois par partie)',
    '🔄 Skip this question': '🔄 Passer cette question', '⏩ Hurry them up': '⏩ On accélère', '▶ Next': '▶ Suivant',
    'Voted to skip': 'Vote pour passer', 'Voted to hurry': 'Vote pour accélérer',
    // TV
    'PRESS START': 'APPUIE SUR START', 'click anywhere · turns on music': 'clique n\'importe où · lance la musique',
    'Scan to join · room code': 'Scanne pour jouer · code', 'Scan or go to': 'Scanne ou va sur', 'Nobody here yet': "Personne pour l'instant",
    'Choose a game': 'Choisis un jeu', 'Play again?': 'On rejoue ?', 'Rounds': 'Manches', 'Timers': 'Minuteurs', 'Default': 'Par défaut',
    'Fast': 'Rapide', 'Normal': 'Normal', 'Relaxed': 'Détendu', 'Extra slow': 'Très lent', '🌶 18+ content': '🌶 Contenu 18+',
    '👥 Teams': '👥 Équipes', '👁 Colour-blind colours': '👁 Couleurs daltoniens', '🗣 Narrator voice': '🗣 Voix du narrateur',
    '⚙ House rules & content': '⚙ Règles maison et contenu', '🏆 Hall of fame': '🏆 Temple de la renommée', 'Skip ⏭': 'Passer ⏭', 'End': 'Fin',
    '🏆 Final scores': '🏆 Scores finaux', '🏆 Grand champion of the night': '🏆 Grand champion de la soirée',
    'Press End to go back to the menu.': 'Appuie sur Fin pour revenir au menu.', 'Check your phone 🤫': 'Regarde ton téléphone 🤫',
    'Check your phones!': 'Regardez vos téléphones !', 'Everyone else, play your worst card!': 'Les autres, jouez votre pire carte !',
    'Vote for the best doodle!': 'Votez pour le meilleur dessin !', 'Two Truths & a Lie': 'Deux vérités, un mensonge',
    'Sweat it out while everyone votes…': 'Transpire pendant que tout le monde vote…', 'No votes. Cowards.': 'Aucun vote. Bande de peureux.',
    'SHUTOUT!': 'BLANCHISSAGE !', 'BULLSEYE!': 'EN PLEIN DANS LE MILLE !', 'Game night': 'Soirée de jeux', 'Remove bots': 'Retirer les robots',
    // rules + blurbs
    'You get 2 prompts — a rival gets each one too': 'Tu reçois 2 invites — un rival a chacune aussi',
    "Everyone else votes: who's funnier?": 'Les autres votent : qui est le plus drôle ?', 'Win every vote = SHUTOUT bonus': 'Tous les votes = bonus BLANCHISSAGE',
    'Write a believable fake answer': 'Écris une fausse réponse crédible', 'Find the TRUE answer among the lies': 'Trouve la VRAIE réponse parmi les mensonges',
    'Points for every friend you fool': 'Des points pour chaque ami berné', 'Pick the right answer — fast!': 'Choisis la bonne réponse — vite !',
    'Answer streaks add bonus points 🔥': 'Les séries rapportent des bonus 🔥', 'Last place picks the next category': 'Le dernier choisit la prochaine catégorie',
    'Guess the number': 'Devine le nombre', 'Closest gets the most points': 'Le plus proche gagne le plus', 'Exact hit = BULLSEYE bonus': 'Pile dessus = bonus',
    'Type what everyone ELSE will say': 'Écris ce que les AUTRES vont dire', 'Match the crowd to score': 'Fais comme la foule pour marquer',
    'Unique answers get nothing': 'Les réponses uniques ne rapportent rien', 'Vote which friend fits the prompt': "Vote pour l'ami qui correspond",
    'Vote with the majority to score': 'Vote avec la majorité pour marquer', 'No hard feelings… probably': 'Sans rancune… probablement',
    'Everyone gets a secret word — except one': 'Tout le monde a un mot secret — sauf un', 'Give a one-word clue': 'Donne un indice en un mot',
    'Vote out the imposter!': "Démasquez l'imposteur !", 'Write 2 truths and 1 lie about you': 'Écris 2 vérités et 1 mensonge sur toi',
    "Spot everyone else's lie": 'Trouve le mensonge des autres', 'Points for each person you fool': 'Des points pour chaque personne bernée',
    'Write a phrase, draw, describe, repeat': 'Écris, dessine, décris, recommence', 'Watch the chains go off the rails': 'Regarde les chaînes dérailler',
    'Vote for the best doodle': 'Vote pour le meilleur dessin', 'A Card Czar reads the prompt': 'Le Tsar des cartes lit la carte',
    'Everyone plays their worst card': 'Tout le monde joue sa pire carte', 'The Czar picks a winner': 'Le Tsar choisit le gagnant',
    'Slip notes to your crushes — phones only': 'Glisse des mots doux à tes béguins — sur les téléphones',
    'Reply, then secretly pick a date': 'Réponds, puis choisis secrètement un rendez-vous',
    'Secret agendas change the scoring': 'Des objectifs secrets changent les points',
    'A singles weekend at the lake: slip notes, reply, pick a date. Secret agendas change everything.': 'Un week-end de célibataires au lac : mots doux, réponses, rendez-vous. Les objectifs secrets changent tout.',
    "Listen to the loon's call": "Écoute l'appel du huard", 'Tap the same rhythm back on your phone': 'Tape le même rythme sur ton téléphone',
    'Nail it together for IN SYNC bonuses': 'Réussissez ensemble pour les bonus EN RYTHME',
    'A rhythm game for the whole room: listen to the loon, then echo the call on your phone — together.': "Un jeu de rythme pour tout le monde : écoute le huard, puis répète son appel sur ton téléphone — ensemble.",
    'Nailed it!': 'Parfait !', 'Close enough': 'Presque', 'Off the beat': 'À côté du rythme', 'IN SYNC!': 'EN RYTHME !',
    'Tune-up': 'Accordage', 'Your Call': 'Ton appel', 'Dawn Chorus': "Chœur de l'aube", 'Paddle Groove': 'Groove de pagaie', 'Moonlight Remix': 'Remix au clair de lune',
    'Tap along with the clicks': 'Tape en même temps que les clics', 'LISTEN…': 'ÉCOUTE…', 'ECHO!': 'RÉPÈTE !',
    'Quick real-time challenges on your phone': 'Des défis éclair en temps réel sur ton téléphone',
    'Tap, react, count, roast — rules shown each time': 'Tape, réagis, compte, grille — règles affichées à chaque fois',
    'Turn on Teams for Red vs Blue!': 'Active les équipes pour Rouges contre Bleus !',
    'Fill in the blank. Whoever the Card Czar picks wins the round.': 'Complète la phrase. Celui que le Tsar choisit gagne la manche.',
    "Bluffing trivia — invent a fake answer, then spot the real one hidden among everyone's lies.": 'Quiz de bluff — invente une fausse réponse, puis trouve la vraie parmi les mensonges.',
    'Fast trivia in category rounds — last place picks the next category.': 'Quiz éclair par catégories — le dernier choisit la suivante.',
    'Quick real-time phone challenges — tap, react, count, roast. Best with Teams on!': 'Défis éclair sur le téléphone — tape, réagis, compte, grille. Meilleur en équipes !',
    'Head-to-head comedy: two players, one prompt, everyone else votes.': 'Duel comique : deux joueurs, une invite, les autres votent.',
    'Guess the number. Nearest wins — exact hits earn a bonus.': 'Devine le nombre. Le plus proche gagne — pile dessus, bonus.',
    'Vote which friend fits the prompt. Score by agreeing with the crowd.': "Vote pour l'ami qui correspond. Marque en suivant la foule.",
    'Write, draw, describe, repeat. Watch your phrase get hilariously mangled.': 'Écris, dessine, décris, recommence. Regarde ta phrase se faire massacrer.',
    'Write two facts and one fib about yourself. Can your friends spot it?': 'Deux vérités et un mensonge sur toi. Tes amis vont-ils trouver ?',
    'Answer what you think everyone else will. Matching the herd pays.': 'Réponds comme les autres. Suivre le troupeau, ça paie.',
    'Everyone knows the secret word — except the imposter. Give clues, find the faker.': "Tout le monde connaît le mot secret — sauf l'imposteur. Indices et démasquage.",
  };

  /** @type {[RegExp, string][]} dynamic UI lines */
  const PATTERNS = [
    [/^Round (\d+) of (\d+)$/, 'Manche $1 sur $2'],
    [/^Question (\d+) of (\d+)$/, 'Question $1 sur $2'],
    [/^Step (\d+) of (\d+)$/, 'Étape $1 sur $2'],
    [/^Player (\d+) of (\d+)$/, 'Joueur $1 sur $2'],
    [/^Minigame (\d+) of (\d+)$/, 'Mini-jeu $1 sur $2'],
    [/^Prompt (\d+) of (\d+)$/, 'Invite $1 sur $2'],
    [/^(\d+) \/ (\d+) (answers in|votes in|guesses in|clues in|done|ready|lies in|cards in|bets placed|picked)$/, '$1 / $2 ✓'],
    [/^(\d+)× POINTS$/, 'POINTS ×$1'],
    [/^Needs (\d+)\+ players$/, '$1+ joueurs requis'],
    [/^(\d+)\+ players$/, '$1+ joueurs'],
    [/^(\d+)\/(\d+) joined$/, '$1/$2 joueurs'],
    [/^(\d+) games$/, '$1 jeux'],
    [/^Matched (\d+) others?!$/, '$1 réponse(s) identique(s) !'],
    [/^You bet (\d+)\.$/, 'Tu as parié $1.'],
    [/^You finished #(\d+) with$/, 'Tu termines nº $1 avec'],
    [/^(.+) wins with (\d+)!$/, '$1 gagne avec $2 !'],
    [/^Still (writing|drawing|guessing):$/, 'Encore en cours :'],
    [/^Category: (.+)$/, 'Catégorie : $1'],
    [/^The truth: (.+)$/, 'La vérité : $1'],
    [/^The word was: (.+)$/, 'Le mot était : $1'],
    [/^Card Czar: (.*)$/, 'Tsar des cartes : $1'],
    [/^(.+) is picking a winner…$/, '$1 choisit le gagnant…'],
    [/^(.+) is guessing…$/, '$1 devine…'],
    [/^(.+) wins the round!$/, '$1 gagne la manche !'],
  ];
  const ATTRS = ['placeholder', 'aria-label', 'title'];

  let lang = 'en';
  /** @param {string} s @returns {string | null} */
  function tr(s) {
    const t = s.trim();
    if (!t) return null;
    let out = FR[t];
    if (out === undefined) {
      for (const [re, rep] of PATTERNS) if (re.test(t)) { out = t.replace(re, rep); break; }
    }
    return out === undefined ? null : s.replace(t, out);
  }
  /** @param {Node} n */
  function fix(n) {
    if (n.nodeType === 3) {
      const v = tr(n.nodeValue || '');
      if (v !== null && v !== n.nodeValue) n.nodeValue = v;
      return;
    }
    if (n.nodeType !== 1) return;
    const el = /** @type {Element} */ (n);
    if (el.closest('#debug-panel')) return;
    for (const a of ATTRS) { const v = el.getAttribute(a); const t = v && tr(v); if (t && t !== v) el.setAttribute(a, t); }
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let c = w.nextNode(); c; c = w.nextNode()) {
      if (c.nodeType === 1) { for (const a of ATTRS) { const e = /** @type {Element} */ (c); const v = e.getAttribute(a); const t = v && tr(v); if (t && t !== v) e.setAttribute(a, t); } } else fix(c);
    }
  }
  const obs = new MutationObserver((muts) => {
    if (lang !== 'fr') return;
    for (const m of muts) {
      if (m.type === 'characterData') fix(m.target);
      else if (m.type === 'attributes') fix(m.target);
      else m.addedNodes.forEach(fix);
    }
  });

  window.Rumpus = window.Rumpus || /** @type {RumpusNS} */ ({});
  window.Rumpus.i18n = {
    FR, PATTERNS, tr,
    lang: () => lang,
    /** @param {string | undefined} l */
    setLang(l) {
      const next = l === 'fr' ? 'fr' : 'en';
      if (next === lang) return;
      lang = next;
      document.documentElement.lang = lang;
      if (lang === 'fr') { fix(document.body); obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
      else obs.disconnect(); // English: the next render puts the original text back
    },
  };
})();
