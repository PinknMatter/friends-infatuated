// SentenceStore: big hardcoded pool + injectRandom trigger + optional external
// dataset. Drop a JSON array of strings at /public/sentences.json and it is
// merged in at startup (this is also the seam where Supabase lands later,
// with an `approved` flag).

export interface SentenceStore {
  /** Builtin + external pools merged (legacy consumers). */
  getAll(): string[];
  /** The hardcoded pool. */
  getBuiltin(): string[];
  /** Crowd pool: Supabase submissions, sentences.json, injected extras. */
  getExternal(): string[];
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
  'Rio learned to skate at thirty just to join us',
  'Pavel brings a speaker everywhere, consequences be damned',
  'We got matching tattoos and only slightly regret the font',
  'Amara notices when anyone in the room goes quiet',
  'He kept my secret for fifteen years and counting',
  'Nos reímos hasta llorar en el metro otra vez',
  'June makes playlists that know me better than I do',
  'The night bus crew, forever undefeated',
  'She defends me in rooms I’m not in',
  'Theo saves the aisle seat for me every single time',
  'She answered the phone at 4am like it was noon',
  'We failed the same exam twice and celebrated anyway',
  'Kim knows my order at every restaurant in this city',
  'He flew back early just to see my show',
  'Priya carries snacks for everyone like a one-woman vending machine',
  'The first thing he asks is always how I’m sleeping',
  'She once fought a seagull for my sandwich and won',
  'We watched the sunrise from a parking garage and it was perfect',
  'Marco hums when he’s happy and doesn’t know it',
  'She kept my plants alive for a whole year abroad',
  'He learned my mom’s recipe just to surprise me',
  'Zoe laughs with her whole body, chairs beware',
  'We built a fort at 25 and felt zero shame',
  'She quotes movies wrong with total confidence',
  'Omar gives directions like a tour guide of his own heart',
  'The way she says my name makes everything less scary',
  'He biked across town in July heat for my birthday cake',
  'We speak entirely in inside jokes now',
  'She never lets me walk home alone',
  'Tariq claps for street performers louder than anyone',
  'My friend keeps a list of things that made me laugh',
  'She wore a suit to my divorce party, iconic',
  'We shared one umbrella for three years of storms',
  'He remembers the names of all my coworkers',
  'Ella sings harmonies to car alarms',
  'The whole crew showed up in costume, no one warned me',
  'She taught me to drive stick in a cemetery, patient as a saint',
  'He mails postcards from every city like it’s 1975',
  'We adopted the ugliest cat in the shelter together',
  'Suki brings a book everywhere and reads none of them',
  'She celebrated my tiny wins like championships',
  'The boys planned a whole picnic with cloth napkins',
  'He knows when I say I’m fine that I’m not',
  'Freya whistles show tunes in hardware stores',
  'We danced in the kitchen until the neighbors joined in',
  'She translated the whole menu so I wouldn’t feel lost',
  'Dev laughs in his sleep and it’s adorable',
  'The road trip playlist is eleven hours and all bangers',
  'She held my hair back and never mentioned it again',
  'He gave the best man speech and made grandpa cry',
  'We planted a garden in milk crates on the roof',
  'Ines sends voice notes like tiny radio shows',
  'The way he greets dogs before people, correct priorities',
  'She kept the receipt from our first coffee, laminated it',
  'We survived retail Christmas together, bonded for life',
  'He practices my presentations with me at midnight',
  'Lucia dances salsa with grandmas at every wedding',
  'The group decided my ex was wrong before I finished the story',
  'She lights up describing bugs, actual insects, and I listen',
  'He carried me piggyback for a mile after the blister incident',
  'We made a secret handshake at 28 years old',
  'Noor prays for me even when I forget to ask',
  'The couch crew assembles every Sunday like clockwork',
  'She texts the group when the moon looks good',
  'He learned to braid hair for his daughter and now does mine',
  'We got lost in Lisbon and found the best night of our lives',
  'Mei sends me photos of clouds that look like dinosaurs',
  'The way she argues with the GPS, undefeated',
  'He saves me the crossword every Saturday',
  'We cried at the airport like a movie scene, zero regrets',
  'She keeps spare gloves in her bag because I always forget mine',
  'Andrés narrates football matches for his blind uncle',
  'The pact is simple: nobody eats alone on their birthday',
  'She drove me to every appointment and never once sighed',
  'He remembers my coffee order changed three years ago',
  'We laughed so hard the librarian gave up on us',
  'Yara paints her friends as constellations',
  'The boys cried at the wedding, all of them, beautiful',
  'She mails me tea bags with handwritten weather reports',
  'He stood in line six hours for tickets and told no one',
  'We fixed the car with a YouTube video and blind faith',
  'Sana knows every shortcut and every long way home',
  'The way he says “text me when you’re home” and means it',
  'She threw me a surprise party in a laundromat',
  'He kept every drawing I made him since third grade',
  'We watched meteor showers from a truck bed, frozen and happy',
  'Nina claps at the end of every movie, theater be damned',
  'The whole squad learned the dance for my sister’s quinceañera',
  'She whispers “you got this” before I even feel nervous',
  'He shares his fries without being asked, true love',
  'We built shelves crooked and called it character',
  'Aiko folds paper cranes during boring meetings and gives them away',
  'The tradition lives: first snow means pancakes at midnight',
  'She read every draft of my terrible novel',
  'He walked eight blocks in slides to bring me charger',
  'We sang wrong lyrics at the top of our lungs on the highway',
  'Petra keeps a couch free for anyone who needs it',
  'The way she introduces me: “this is my person”',
  'He got a matching keychain, unprompted, for everyone',
  'We survived the group project and became unbreakable',
  'Idris tips street musicians with his last coins',
  'She scheduled a call across nine time zones for my birthday',
  'The crew still meets at the same diner, same booth',
  'He canceled a date because my dog was sick',
  'We got caught in the rain and just stopped running',
  'Vera brings soup like it’s a love language, because it is',
  'The way he remembers everyone’s allergies at dinner parties',
  'She yelled my name at the finish line louder than the announcer',
  'He kept the streak alive for six years, never missed a day',
  'We fell asleep on the ferry and missed the stop, worth it',
  'Tunde makes everyone feel like the funniest person alive',
  'She saves the window seat for me on every train',
  'The blanket fort summit of 2019 remains classified',
  'He drew a map of our favorite places and framed it',
  'We toasted with juice boxes on the fire escape',
  'Greta waters my plants and talks to them about me',
  'The way she claps when the bread comes to the table',
  'He waited with me for the tow truck for four hours',
  'We invented a holiday and our families celebrate it now',
  'Bao sends the group sunrise pictures from his night shifts',
  'She learned all my siblings’ birthdays by heart',
  'The pact to never let each other text exes has saved lives',
  'He turned his trunk into a mobile picnic for us',
  'We whisper-shouted through the whole silent disco',
  'Alba keeps polaroids of every friend on her fridge',
  'The way he stands up when anyone arrives at the table',
  'She wrote my name in wet cement, we ran',
  'He memorized my schedule just to send lunch reminders',
  'We stayed up doing the crossword until the sun apologized',
  'Zainab hems everyone’s pants and refuses payment forever',
  'The couch has our names in permanent dents',
  'She carries plasters because I keep breaking in new shoes',
  'He honks the special honk so I know it’s him',
  'We planted a tree the day we all moved apart',
  'Old friends who need no catching up, just continuing',
  'She lied about liking hiking for two years for me',
  'The way he pockets shells from every beach for us',
  'We wore suits to the McDonald’s drive-through, formal Friday',
  'Carmen tells my story better than I lived it',
  'He shows up early to help set up, always, everywhere',
  'We watched the eclipse through one pair of glasses, taking turns',
  'She keeps my spare key and my spare courage',
  'The birthday cake had my face on it, printed, terrifying, perfect',
  'He taught me chess and lets me win exactly never',
  'We ran through the sprinklers in office clothes',
  'Amina prays, Dora meditates, I nap, we all show up',
  'The way she orders “the usual” for me when I’m late',
  'He built a ramp for the neighbor’s old dog',
  'We hummed the whole soundtrack during the credits',
  'She never says “I told you so”, and she could',
  'The camping trip flooded and we laughed until sunrise',
  'He gives book recommendations like prescriptions, always right',
  'We split the last dumpling with surgical precision',
  'Farid feeds every stray cat on his street by name',
  'The way she saves voicemails from people she loves',
  'He stayed on video call while I walked the dark parking lot',
  'We chose the same city without telling each other',
  'Her laugh from three rooms away is my favorite song',
  'The annual bad-movie marathon is sacred and non-negotiable',
  'He learned to cook one perfect dish for potlucks, legend',
  'We sat on the roof saying nothing and it said everything',
  'Elif brings extra hair ties like a guardian angel',
  'The way he always takes the middle seat without complaint',
  'She cheered for my bad poetry like it was Shakespeare',
  'We made eye contact during the toast and lost it completely',
  'He remembers what I was wearing when we met',
  'The five-hour phone calls that feel like five minutes',
  'She flew standby for two days to make the funeral',
  'We paint each other’s nails badly and proudly',
  'His mom calls me her third kid and I cry every time',
  'The way she waves with both hands like a ferry departing',
  'We joke that we share one brain cell and today it’s mine',
  'He signs every text to the group “love you idiots”',
  'She keeps the porch light on when I drive home late',
  'Nos conocimos en la fila del baño y ya son diez años',
  'On s’est promis d’être vieux ensemble sur le même banc',
  'Ela guarda meu lugar na mesa como se fosse sagrado',
  'Lui ride prima ancora che io racconti la barzelletta',
  'Ze stuurt me foto’s van elke hond die ze ziet',
  'Мы дружим так давно, что молчать вместе — уже разговор',
  'あの子は私の分まで傘を持ってくる',
  '우리는 라면 하나로도 파티를 만든다',
  'صديقي يحفظ أعياد ميلاد الجميع عن ظهر قلب',
  'Er hebt jedes Konzertticket auf, seit zwanzig Jahren',
  'Hun lærte seg språket mitt bare for å forstå vitsene mine',
];

const EXTRA: string[] = [
  'She whispered the answers to my heart like a cheat code',
  'Pavel brings a speaker everywhere, consequences be damned',
  'We got matching tattoos and only slightly regret the font',
  'The new kid joined the group chat and fit like a puzzle piece',
  'He kept my secret for fifteen years and counting',
  'June makes playlists that know me better than I do',
  'The night bus crew, forever undefeated',
  'She defends me in rooms I’m not in',
  'We adopted a plant together and named it after our landlord',
  'He texted “outside” and he was, with tacos',
  'She learned to whistle just to answer my whistle',
  'The last slice always gets split, house rules',
  'He drew our friendship as a comic strip for my birthday',
  'We agreed to be each other’s emergency contact forever',
  'She brought two coffees because “you sounded tired in your text”',
];

export class StaticSentenceStore implements SentenceStore {
  // Two pools kept apart so the layout engine can weight crowd sentences
  // against builtins (data/dbMix) and retire builtins at takeover.
  private builtin: string[] = [...POOL];
  private external: string[] = [];
  private extras: string[] = [...EXTRA];
  private listeners: ((s: string) => void)[] = [];

  getAll(): string[] {
    return [...this.builtin, ...this.external];
  }

  getBuiltin(): string[] {
    return [...this.builtin];
  }

  getExternal(): string[] {
    return [...this.external];
  }

  onAdded(cb: (sentence: string) => void): void {
    this.listeners.push(cb);
  }

  private has(s: string): boolean {
    return this.builtin.includes(s) || this.external.includes(s);
  }

  /**
   * Add a sentence from an external live source (Supabase sync). Poem line
   * breaks are collapsed — the layout engine is word-based. Returns false if
   * rejected (duplicate or out of bounds).
   */
  addExternal(raw: string): boolean {
    const s = raw.replace(/\s+/g, ' ').trim();
    const words = s.split(' ').length;
    if (s.length < 3 || s.length > 300 || words > 40) return false;
    if (this.has(s)) return false;
    this.external.push(s);
    for (const cb of this.listeners) cb(s);
    return true;
  }

  /** Wired to the data/injectRandom trigger in the control panel. Feeds the
   *  external pool — it simulates a crowd submission (tests the DB mix path). */
  injectRandom(): void {
    const s =
      this.extras.length > 0
        ? this.extras.splice(Math.floor(Math.random() * this.extras.length), 1)[0]
        : POOL[Math.floor(Math.random() * POOL.length)];
    this.external.push(s);
    for (const cb of this.listeners) cb(s);
  }

  /**
   * Merge an external dataset: /public/sentences.json as a JSON array of
   * strings. Silently skipped when the file doesn't exist. Sentences are
   * deduped and length-clamped (3–24 words).
   */
  async loadExternal(): Promise<number> {
    try {
      const res = await fetch('/sentences.json');
      if (!res.ok) return 0;
      const data: unknown = await res.json();
      if (!Array.isArray(data)) return 0;
      const seen = new Set([...this.builtin, ...this.external]);
      let added = 0;
      for (const item of data) {
        if (typeof item !== 'string') continue;
        const s = item.trim();
        const words = s.split(/\s+/).length;
        if (s.length === 0 || words < 3 || words > 24 || seen.has(s)) continue;
        seen.add(s);
        this.external.push(s);
        added++;
      }
      return added;
    } catch {
      return 0;
    }
  }
}
