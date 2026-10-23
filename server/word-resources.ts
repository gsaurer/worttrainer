import { z } from 'zod'
import { validateWord, type WordResource } from '../shared/model.js'
import { languageSchema } from './languages.js'

const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80)
const spelling = z.string().trim().refine(value => validateWord(value) === null)
const translation = z.object({ language: languageSchema, word: spelling }).strict()
const entry = z.object({
  id: identifier,
  word: spelling,
  sentence: z.string().trim().min(1).max(2000),
  translations: z.array(translation).max(26).refine(items => new Set(items.map(item => item.language)).size === items.length),
}).strict()
const section = z.object({
  id: identifier,
  title: z.string().trim().min(1).max(200),
  entries: z.array(entry).min(1).max(1000).refine(items => new Set(items.map(item => item.id)).size === items.length),
}).strict()
export const resourceCatalogSchema = z.array(z.object({
  id: identifier,
  title: z.string().trim().min(1).max(200),
  language: languageSchema,
  sections: z.array(section).min(1).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length),
}).strict().refine(resource => resource.sections.every(item => item.entries.every(word => word.translations.every(item => item.language !== resource.language))))).max(1000)
  .refine(resources => new Set(resources.map(resource => resource.id)).size === resources.length)

export const wordResources: WordResource[] = resourceCatalogSchema.parse([
  {
    id: 'everyday-english', title: 'Everyday English', language: 'en',
    sections: [
      {
        id: 'at-school', title: 'At school', entries: [
          { id: 'book', word: 'book', sentence: 'The book is on the table.', translations: [{ language: 'de', word: 'Buch' }] },
          { id: 'pencil', word: 'pencil', sentence: 'I write with a pencil.', translations: [{ language: 'de', word: 'Stift' }] },
          { id: 'school', word: 'school', sentence: 'We walk to school.', translations: [{ language: 'de', word: 'Schule' }] },
          { id: 'teacher', word: 'teacher', sentence: 'The teacher reads a story.', translations: [{ language: 'de', word: 'Lehrer' }] },
          { id: 'friend', word: 'friend', sentence: 'My friend sits next to me.', translations: [{ language: 'de', word: 'Freund' }] },
        ],
      },
      {
        id: 'at-home', title: 'At home', entries: [
          { id: 'house', word: 'house', sentence: 'Our house has a garden.', translations: [{ language: 'de', word: 'Haus' }] },
          { id: 'window', word: 'window', sentence: 'The window is open.', translations: [{ language: 'de', word: 'Fenster' }] },
          { id: 'water', word: 'water', sentence: 'I drink a glass of water.', translations: [{ language: 'de', word: 'Wasser' }] },
          { id: 'apple', word: 'apple', sentence: 'The apple is red.', translations: [{ language: 'de', word: 'Apfel' }] },
          { id: 'cat', word: 'cat', sentence: 'The cat sleeps on a chair.', translations: [{ language: 'de', word: 'Katze' }] },
        ],
      },
    ],
  },
  {
    id: 'deutsch-im-alltag', title: 'Deutsch im Alltag', language: 'de',
    sections: [
      {
        id: 'in-der-schule', title: 'In der Schule', entries: [
          { id: 'buch', word: 'Buch', sentence: 'Ich lese ein Buch.', translations: [{ language: 'en', word: 'book' }] },
          { id: 'stift', word: 'Stift', sentence: 'Mein Stift ist blau.', translations: [{ language: 'en', word: 'pencil' }] },
          { id: 'schule', word: 'Schule', sentence: 'Die Schule ist nah.', translations: [{ language: 'en', word: 'school' }] },
          { id: 'wort', word: 'Wort', sentence: 'Wir lernen ein neues Wort.', translations: [{ language: 'en', word: 'word' }] },
          { id: 'freund', word: 'Freund', sentence: 'Mein Freund liest mit mir.', translations: [{ language: 'en', word: 'friend' }] },
        ],
      },
      {
        id: 'zu-hause', title: 'Zu Hause', entries: [
          { id: 'haus', word: 'Haus', sentence: 'Unser Haus hat einen Garten.', translations: [{ language: 'en', word: 'house' }] },
          { id: 'fenster', word: 'Fenster', sentence: 'Das Fenster ist offen.', translations: [{ language: 'en', word: 'window' }] },
          { id: 'wasser', word: 'Wasser', sentence: 'Ich trinke Wasser.', translations: [{ language: 'en', word: 'water' }] },
          { id: 'apfel', word: 'Apfel', sentence: 'Der Apfel ist rot.', translations: [{ language: 'en', word: 'apple' }] },
          { id: 'katze', word: 'Katze', sentence: 'Die Katze sitzt im Garten.', translations: [{ language: 'en', word: 'cat' }] },
        ],
      },
    ],
  },
  {
    id: 'premiers-mots', title: 'Premiers mots', language: 'fr',
    sections: [
      {
        id: 'a-la-maison', title: 'La maison', entries: [
          { id: 'maison', word: 'maison', sentence: 'La maison a un jardin.', translations: [{ language: 'en', word: 'house' }, { language: 'de', word: 'Haus' }] },
          { id: 'livre', word: 'livre', sentence: 'Le livre est sur la table.', translations: [{ language: 'en', word: 'book' }, { language: 'de', word: 'Buch' }] },
          { id: 'eau', word: 'eau', sentence: 'Je bois de l\'eau.', translations: [{ language: 'en', word: 'water' }, { language: 'de', word: 'Wasser' }] },
          { id: 'pomme', word: 'pomme', sentence: 'La pomme est rouge.', translations: [{ language: 'en', word: 'apple' }, { language: 'de', word: 'Apfel' }] },
          { id: 'chat', word: 'chat', sentence: 'Le chat dort.', translations: [{ language: 'en', word: 'cat' }, { language: 'de', word: 'Katze' }] },
        ],
      },
      {
        id: 'dans-le-jardin', title: 'Le jardin', entries: [
          { id: 'jardin', word: 'jardin', sentence: 'Le jardin est grand.', translations: [{ language: 'en', word: 'garden' }] },
          { id: 'soleil', word: 'soleil', sentence: 'Le soleil brille.', translations: [{ language: 'en', word: 'sun' }] },
          { id: 'chien', word: 'chien', sentence: 'Le chien joue.', translations: [{ language: 'en', word: 'dog' }] },
          { id: 'arbre', word: 'arbre', sentence: 'Un oiseau est dans l\'arbre.', translations: [{ language: 'en', word: 'tree' }] },
          { id: 'fleur', word: 'fleur', sentence: 'La fleur est rouge.', translations: [{ language: 'en', word: 'flower' }] },
        ],
      },
    ],
  },
  {
    id: 'demo-deutsche-stolperwoerter', title: 'Demo: Deutsche Stolperwörter (50 Wörter)', language: 'de',
    sections: [
      {
        id: 'doppelte-konsonanten', title: 'Doppelte Konsonanten', entries: [
          { id: 'adresse', word: 'Adresse', sentence: 'Schreibe deine Adresse auf den Brief.', translations: [{ language: 'en', word: 'address' }] },
          { id: 'interessant', word: 'interessant', sentence: 'Ich finde die Geschichte interessant.', translations: [{ language: 'en', word: 'interesting' }] },
          { id: 'aggressiv', word: 'aggressiv', sentence: 'Der Hund wirkt aggressiv.', translations: [{ language: 'en', word: 'aggressive' }] },
          { id: 'bisschen', word: 'bisschen', sentence: 'Ich brauche ein bisschen Hilfe.', translations: [{ language: 'en', word: 'bit' }] },
          { id: 'hoffentlich', word: 'hoffentlich', sentence: 'Hoffentlich scheint morgen die Sonne.', translations: [{ language: 'en', word: 'hopefully' }] },
          { id: 'parallel', word: 'parallel', sentence: 'Die beiden Linien verlaufen parallel.', translations: [{ language: 'en', word: 'parallel' }] },
          { id: 'karussell', word: 'Karussell', sentence: 'Das Karussell dreht sich langsam.', translations: [{ language: 'en', word: 'carousel' }] },
          { id: 'terrasse', word: 'Terrasse', sentence: 'Wir essen auf der Terrasse.', translations: [{ language: 'en', word: 'terrace' }] },
          { id: 'appellieren', word: 'appellieren', sentence: 'Wir appellieren an eure Geduld.', translations: [{ language: 'en', word: 'appeal' }] },
          { id: 'intelligent', word: 'intelligent', sentence: 'Ihre Antwort ist sehr intelligent.', translations: [{ language: 'en', word: 'intelligent' }] },
        ],
      },
      {
        id: 'i-ie-und-y', title: 'i, ie und y', entries: [
          { id: 'wieder', word: 'wieder', sentence: 'Wir sehen uns morgen wieder.', translations: [{ language: 'en', word: 'again' }] },
          { id: 'widerspiegeln', word: 'widerspiegeln', sentence: 'Die Zahlen sollen den Fortschritt widerspiegeln.', translations: [{ language: 'en', word: 'reflect' }] },
          { id: 'widerstehen', word: 'widerstehen', sentence: 'Ich kann dem Kuchen kaum widerstehen.', translations: [{ language: 'en', word: 'resist' }] },
          { id: 'maschine', word: 'Maschine', sentence: 'Die Maschine arbeitet sehr leise.', translations: [{ language: 'en', word: 'machine' }] },
          { id: 'rhythmus', word: 'Rhythmus', sentence: 'Wir klatschen im gleichen Rhythmus.', translations: [{ language: 'en', word: 'rhythm' }] },
          { id: 'sympathisch', word: 'sympathisch', sentence: 'Unser neuer Nachbar ist sympathisch.', translations: [{ language: 'en', word: 'likeable' }] },
          { id: 'ziemlich', word: 'ziemlich', sentence: 'Der Weg ist ziemlich lang.', translations: [{ language: 'en', word: 'quite' }] },
          { id: 'schwierig', word: 'schwierig', sentence: 'Diese Aufgabe ist schwierig.', translations: [{ language: 'en', word: 'difficult' }] },
          { id: 'fieber', word: 'Fieber', sentence: 'Mit Fieber bleibe ich im Bett.', translations: [{ language: 'en', word: 'fever' }] },
          { id: 'vibrieren', word: 'vibrieren', sentence: 'Die Lautsprecher vibrieren beim Spielen.', translations: [{ language: 'en', word: 'vibrate' }] },
        ],
      },
      {
        id: 's-ss-und-eszett', title: 's, ss und ß', entries: [
          { id: 'strasse', word: 'Straße', sentence: 'Unsere Straße ist heute gesperrt.', translations: [{ language: 'en', word: 'street' }] },
          { id: 'heissen', word: 'heißen', sentence: 'Wie heißen deine Freunde?', translations: [{ language: 'en', word: 'be called' }] },
          { id: 'fussball', word: 'Fußball', sentence: 'Wir spielen nach der Schule Fußball.', translations: [{ language: 'en', word: 'football' }] },
          { id: 'draussen', word: 'draußen', sentence: 'Die Kinder spielen draußen.', translations: [{ language: 'en', word: 'outside' }] },
          { id: 'schliesslich', word: 'schließlich', sentence: 'Schließlich fanden wir den richtigen Weg.', translations: [{ language: 'en', word: 'finally' }] },
          { id: 'fleissig', word: 'fleißig', sentence: 'Die Klasse übt fleißig für das Diktat.', translations: [{ language: 'en', word: 'diligent' }] },
          { id: 'reissen', word: 'reißen', sentence: 'Die dünnen Fäden reißen leicht.', translations: [{ language: 'en', word: 'tear' }] },
          { id: 'schliessen', word: 'schließen', sentence: 'Bitte die Fenster schließen.', translations: [{ language: 'en', word: 'close' }] },
          { id: 'geniessen', word: 'genießen', sentence: 'Wir genießen den sonnigen Tag.', translations: [{ language: 'en', word: 'enjoy' }] },
          { id: 'suess', word: 'süß', sentence: 'Die Erdbeeren schmecken süß.', translations: [{ language: 'en', word: 'sweet' }] },
        ],
      },
      {
        id: 'stumme-buchstaben-und-wortbausteine', title: 'Stumme Buchstaben und Wortbausteine', entries: [
          { id: 'naemlich', word: 'nämlich', sentence: 'Wir brauchen nur eine Sache, nämlich Geduld.', translations: [{ language: 'en', word: 'namely' }] },
          { id: 'gefaehrlich', word: 'gefährlich', sentence: 'Das Spielen auf der Straße ist gefährlich.', translations: [{ language: 'en', word: 'dangerous' }] },
          { id: 'ehrlich', word: 'ehrlich', sentence: 'Bitte antworte ehrlich auf die Frage.', translations: [{ language: 'en', word: 'honest' }] },
          { id: 'gewohnheit', word: 'Gewohnheit', sentence: 'Tägliches Lesen ist eine gute Gewohnheit.', translations: [{ language: 'en', word: 'habit' }] },
          { id: 'waehrend', word: 'während', sentence: 'Während der Pause essen wir einen Apfel.', translations: [{ language: 'en', word: 'during' }] },
          { id: 'fahrrad', word: 'Fahrrad', sentence: 'Mein Fahrrad steht vor dem Haus.', translations: [{ language: 'en', word: 'bicycle' }] },
          { id: 'geburtstag', word: 'Geburtstag', sentence: 'Zu meinem Geburtstag backen wir einen Kuchen.', translations: [{ language: 'en', word: 'birthday' }] },
          { id: 'weihnachten', word: 'Weihnachten', sentence: 'An Weihnachten besuchen wir unsere Familie.', translations: [{ language: 'en', word: 'Christmas' }] },
          { id: 'fruehstueck', word: 'Frühstück', sentence: 'Zum Frühstück esse ich Brot.', translations: [{ language: 'en', word: 'breakfast' }] },
          { id: 'erwachsen', word: 'erwachsen', sentence: 'Wenn ich erwachsen bin, möchte ich reisen.', translations: [{ language: 'en', word: 'grown-up' }] },
        ],
      },
      {
        id: 'weitere-stolperwoerter', title: 'Weitere Stolperwörter', entries: [
          { id: 'vielleicht', word: 'vielleicht', sentence: 'Vielleicht gehen wir morgen schwimmen.', translations: [{ language: 'en', word: 'perhaps' }] },
          { id: 'standard', word: 'Standard', sentence: 'Dieses Heft entspricht dem üblichen Standard.', translations: [{ language: 'en', word: 'standard' }] },
          { id: 'paket', word: 'Paket', sentence: 'Vor der Tür liegt ein Paket.', translations: [{ language: 'en', word: 'parcel' }] },
          { id: 'quittung', word: 'Quittung', sentence: 'Bitte bewahre die Quittung auf.', translations: [{ language: 'en', word: 'receipt' }] },
          { id: 'reparatur', word: 'Reparatur', sentence: 'Die Reparatur des Fahrrads dauert einen Tag.', translations: [{ language: 'en', word: 'repair' }] },
          { id: 'grammatik', word: 'Grammatik', sentence: 'Wir üben heute die deutsche Grammatik.', translations: [{ language: 'en', word: 'grammar' }] },
          { id: 'katastrophe', word: 'Katastrophe', sentence: 'Das Hochwasser war eine Katastrophe.', translations: [{ language: 'en', word: 'disaster' }] },
          { id: 'voraussetzung', word: 'Voraussetzung', sentence: 'Geduld ist eine wichtige Voraussetzung.', translations: [{ language: 'en', word: 'prerequisite' }] },
          { id: 'ausserdem', word: 'außerdem', sentence: 'Wir brauchen außerdem Papier und einen Stift.', translations: [{ language: 'en', word: 'also' }] },
          { id: 'morgens', word: 'morgens', sentence: 'Ich trinke morgens ein Glas Wasser.', translations: [{ language: 'en', word: 'mornings' }] },
        ],
      },
    ],
  },
  {
    id: 'demo-english-spelling-traps', title: 'Demo: English spelling traps (50 words)', language: 'en',
    sections: [
      {
        id: 'double-letters', title: 'Double letters', entries: [
          { id: 'accommodate', word: 'accommodate', sentence: 'The hall can accommodate our whole class.', translations: [{ language: 'de', word: 'unterbringen' }] },
          { id: 'beginning', word: 'beginning', sentence: 'Read the beginning of the story.', translations: [{ language: 'de', word: 'Anfang' }] },
          { id: 'committee', word: 'committee', sentence: 'The committee meets on Friday.', translations: [{ language: 'de', word: 'Ausschuss' }] },
          { id: 'embarrass', word: 'embarrass', sentence: 'I did not mean to embarrass my friend.', translations: [{ language: 'de', word: 'blamieren' }] },
          { id: 'necessary', word: 'necessary', sentence: 'A warm coat is necessary in winter.', translations: [{ language: 'de', word: 'notwendig' }] },
          { id: 'occasion', word: 'occasion', sentence: 'We baked a cake for the occasion.', translations: [{ language: 'de', word: 'Anlass' }] },
          { id: 'occurrence', word: 'occurrence', sentence: 'Snow in April is a rare occurrence here.', translations: [{ language: 'de', word: 'Vorkommen' }] },
          { id: 'recommend', word: 'recommend', sentence: 'Can you recommend a good book?', translations: [{ language: 'de', word: 'empfehlen' }] },
          { id: 'tomorrow', word: 'tomorrow', sentence: 'We will visit the library tomorrow.', translations: [{ language: 'de', word: 'morgen' }] },
          { id: 'successful', word: 'successful', sentence: 'Our first attempt was successful.', translations: [{ language: 'de', word: 'erfolgreich' }] },
        ],
      },
      {
        id: 'vowels-and-letter-order', title: 'Vowels and letter order', entries: [
          { id: 'believe', word: 'believe', sentence: 'I believe you can solve this puzzle.', translations: [{ language: 'de', word: 'glauben' }] },
          { id: 'receive', word: 'receive', sentence: 'We receive a letter every week.', translations: [{ language: 'de', word: 'erhalten' }] },
          { id: 'achieve', word: 'achieve', sentence: 'Daily practice helps us achieve our goals.', translations: [{ language: 'de', word: 'erreichen' }] },
          { id: 'friend', word: 'friend', sentence: 'My friend walks to school with me.', translations: [{ language: 'de', word: 'Freund' }] },
          { id: 'piece', word: 'piece', sentence: 'Please give me a piece of paper.', translations: [{ language: 'de', word: 'Stück' }] },
          { id: 'weird', word: 'weird', sentence: 'We heard a weird noise outside.', translations: [{ language: 'de', word: 'seltsam' }] },
          { id: 'ceiling', word: 'ceiling', sentence: 'The lamp hangs from the ceiling.', translations: [{ language: 'de', word: 'Zimmerdecke' }] },
          { id: 'foreign', word: 'foreign', sentence: 'Learning a foreign language takes practice.', translations: [{ language: 'de', word: 'fremd' }] },
          { id: 'separate', word: 'separate', sentence: 'Keep the clean clothes in a separate bag.', translations: [{ language: 'de', word: 'getrennt' }] },
          { id: 'definite', word: 'definite', sentence: 'We need a definite answer today.', translations: [{ language: 'de', word: 'eindeutig' }] },
        ],
      },
      {
        id: 'silent-letters', title: 'Silent letters', entries: [
          { id: 'answer', word: 'answer', sentence: 'Write your answer on the next line.', translations: [{ language: 'de', word: 'Antwort' }] },
          { id: 'business', word: 'business', sentence: 'My aunt runs a small business.', translations: [{ language: 'de', word: 'Geschäft' }] },
          { id: 'debt', word: 'debt', sentence: 'He paid his debt last month.', translations: [{ language: 'de', word: 'Schuld' }] },
          { id: 'doubt', word: 'doubt', sentence: 'I have no doubt that you will succeed.', translations: [{ language: 'de', word: 'Zweifel' }] },
          { id: 'february', word: 'February', sentence: 'February is the shortest month.', translations: [{ language: 'de', word: 'Februar' }] },
          { id: 'island', word: 'island', sentence: 'We took a boat to the island.', translations: [{ language: 'de', word: 'Insel' }] },
          { id: 'knowledge', word: 'knowledge', sentence: 'Reading helps us gain knowledge.', translations: [{ language: 'de', word: 'Wissen' }] },
          { id: 'receipt', word: 'receipt', sentence: 'Keep the receipt after you pay.', translations: [{ language: 'de', word: 'Quittung' }] },
          { id: 'wednesday', word: 'Wednesday', sentence: 'Our next lesson is on Wednesday.', translations: [{ language: 'de', word: 'Mittwoch' }] },
          { id: 'government', word: 'government', sentence: 'The government announced a new plan.', translations: [{ language: 'de', word: 'Regierung' }] },
        ],
      },
      {
        id: 'longer-words', title: 'Longer words', entries: [
          { id: 'beautiful', word: 'beautiful', sentence: 'The garden is full of beautiful flowers.', translations: [{ language: 'de', word: 'schön' }] },
          { id: 'calendar', word: 'calendar', sentence: 'Mark the date on your calendar.', translations: [{ language: 'de', word: 'Kalender' }] },
          { id: 'environment', word: 'environment', sentence: 'We can all help protect the environment.', translations: [{ language: 'de', word: 'Umwelt' }] },
          { id: 'excellent', word: 'excellent', sentence: 'You did an excellent job today.', translations: [{ language: 'de', word: 'ausgezeichnet' }] },
          { id: 'experience', word: 'experience', sentence: 'The camping trip was a new experience.', translations: [{ language: 'de', word: 'Erfahrung' }] },
          { id: 'independent', word: 'independent', sentence: 'She is becoming more independent.', translations: [{ language: 'de', word: 'selbstständig' }] },
          { id: 'interested', word: 'interested', sentence: 'I am interested in learning about space.', translations: [{ language: 'de', word: 'interessiert' }] },
          { id: 'privilege', word: 'privilege', sentence: 'It is a privilege to play for the team.', translations: [{ language: 'de', word: 'Privileg' }] },
          { id: 'restaurant', word: 'restaurant', sentence: 'We had dinner at a small restaurant.', translations: [{ language: 'de', word: 'Restaurant' }] },
          { id: 'temperature', word: 'temperature', sentence: 'The temperature will rise this afternoon.', translations: [{ language: 'de', word: 'Temperatur' }] },
        ],
      },
      {
        id: 'everyday-tricky-words', title: 'Everyday tricky words', entries: [
          { id: 'because', word: 'because', sentence: 'We stayed inside because it was raining.', translations: [{ language: 'de', word: 'weil' }] },
          { id: 'definitely', word: 'definitely', sentence: 'I will definitely come to your party.', translations: [{ language: 'de', word: 'definitiv' }] },
          { id: 'different', word: 'different', sentence: 'Try solving the puzzle in a different way.', translations: [{ language: 'de', word: 'anders' }] },
          { id: 'enough', word: 'enough', sentence: 'We have enough chairs for everyone.', translations: [{ language: 'de', word: 'genug' }] },
          { id: 'exercise', word: 'exercise', sentence: 'Finish the exercise before the bell rings.', translations: [{ language: 'de', word: 'Übung' }] },
          { id: 'grammar', word: 'grammar', sentence: 'We learn grammar in our language lesson.', translations: [{ language: 'de', word: 'Grammatik' }] },
          { id: 'guarantee', word: 'guarantee', sentence: 'The shop offers a guarantee on the bicycle.', translations: [{ language: 'de', word: 'Garantie' }] },
          { id: 'language', word: 'language', sentence: 'Which language would you like to learn?', translations: [{ language: 'de', word: 'Sprache' }] },
          { id: 'surprise', word: 'surprise', sentence: 'We planned a surprise for her birthday.', translations: [{ language: 'de', word: 'Überraschung' }] },
          { id: 'until', word: 'until', sentence: 'Please wait here until I return.', translations: [{ language: 'de', word: 'bis' }] },
        ],
      },
    ],
  },
])