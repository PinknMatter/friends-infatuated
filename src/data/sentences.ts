// SentenceStore: stage-1 hardcoded pool + injectRandom trigger.
// Later: Supabase implementation behind the same interface (with `approved` flag).

export interface SentenceStore {
  getAll(): string[];
  onAdded(cb: (sentence: string) => void): void;
}

const POOL: string[] = [
  'Maya laughs so hard she forgets how to breathe',
  'Tom once drove four hours just to bring me soup',
  'She remembers everyone’s coffee order',
  'Dani texts back in 0.2 seconds every single time',
  'He gave me his jacket in the rain and swore he wasn’t cold',
  'Nobody dances like Karim, nobody',
  'She calls her grandma every Sunday without fail',
  'We met in a mosh pit and never left each other',
  'Lena kept every ticket stub from every show we ever went to',
  'He believed in me before I did',
  'Sam can fix literally anything with a zip tie',
  'Mi mejor amiga cruza la ciudad entera solo para abrazarme',
  'She stayed on the phone until I fell asleep',
  'Jonas quit his job to follow the tour and I respect that',
  'The way Aisha tells a story should be illegal',
  'He cried at my graduation harder than my mom',
  'Rosa cooks for twelve when three people show up',
  'We’ve been friends since the first day of kindergarten',
  'She sends me songs at 3am that fix everything',
  'Milo walked me home every night that whole terrible winter',
  'Il fait toujours semblant de connaître les paroles',
  'She learned sign language just to talk to my brother',
  'Ben laughs at his own jokes before the punchline',
  'My best friend held my hand through the whole flight',
  'Ana always saves me the last bite',
  'He drove through a snowstorm for my birthday',
  'Wir haben uns im Regen kennengelernt und nie wieder losgelassen',
  'She never once made me feel small',
  'Kofi hypes up strangers at the club like they’re family',
  'The group chat has been alive for nine years straight',
  'She showed up with pizza before I even said I was sad',
  'Leo gives the kind of hugs that reset your whole week',
  'We planned a whole festival trip during one lunch break',
  'She keeps a photo of us from 2011 in her wallet',
  'He apologizes first, every time, and means it',
  'Nadia dances like the rent is paid and the world is kind',
  'My friends are the family I chose and I chose so well',
  'He waited outside the exam hall with snacks and zero doubt',
  'Sofia claps when the plane lands and I love her for it',
  'Ten years later and we still finish each other’s sentences',
];

const EXTRA: string[] = [
  'Rio learned to skate at thirty just to join us',
  'She whispered the answers to my heart like a cheat code',
  'Pavel brings a speaker everywhere, consequences be damned',
  'We got matching tattoos and only slightly regret the font',
  'Amara notices when anyone in the room goes quiet',
  'He kept my secret for fifteen years and counting',
  'Nos reímos hasta llorar en el metro otra vez',
  'June makes playlists that know me better than I do',
  'The night bus crew, forever undefeated',
  'She defends me in rooms I’m not in',
];

export class StaticSentenceStore implements SentenceStore {
  private sentences: string[] = [...POOL];
  private extras: string[] = [...EXTRA];
  private listeners: ((s: string) => void)[] = [];

  getAll(): string[] {
    return [...this.sentences];
  }

  onAdded(cb: (sentence: string) => void): void {
    this.listeners.push(cb);
  }

  /** Wired to the data/injectRandom trigger in the control panel. */
  injectRandom(): void {
    const s =
      this.extras.length > 0
        ? this.extras.splice(Math.floor(Math.random() * this.extras.length), 1)[0]
        : POOL[Math.floor(Math.random() * POOL.length)];
    this.sentences.push(s);
    for (const cb of this.listeners) cb(s);
  }
}
