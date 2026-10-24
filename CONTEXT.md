# Worttrainer

Private spelling practice with paper answers and adult-reviewed results.

## Language

**Parent account**:
An adult's sign-in identity and the owner of a private word collection and its
practice history. Separate registrations do not share collections.
_Avoid_: Shared installation account, family membership

**Account practice data**:
A parent account's website language, practice-language preferences, word collection, practice attempts, and
saved challenges, including recognized handwriting. It does not include sign-in credentials.
_Avoid_: Account metadata

**Website language**:
The language of the website's menus, instructions, and messages, chosen separately
from the languages of the words and dictation. Each parent account has its own choice.

**Word collection**:
The correct spellings a parent account has chosen to practice, grouped by
language and current learning category.
Collection lists these words immediately with independent language/category filters
and optional spelling search. Aggregate reporting belongs to the separate Statistics tab.

**Word resource**:
A centrally maintained book or predefined word list in one language. Its named
sections contain words, example sentences, and optional translations with their
own language. Parent accounts can browse resources but cannot edit the catalog.

**Resource import**:
An explicit addition of selected resource sections to a private word collection.
Only missing own-language words are copied as Default; existing progress is retained.
Importing is not a practice attempt or a live subscription to catalog changes.
Sentences and translations are retained centrally for future vocabulary training,
not used in current dictation. Enabling a disabled resource language requires
explicit consent and does not change the account's default language.

**Practice source**:
The **Practice from** menu groups each added list's whole-list choice and named
sections together. Selecting a section restricts the challenge to that section's
owned words; the separate learning-category filter still applies. Selection does
not add words or change their shared progress.

**Enabled language**:
A language a parent account has chosen for adding words and starting new challenges.
Disabling it keeps its existing words, progress, and saved challenges.

**Default language**:
The enabled language selected initially when adding a word or setting up practice.
Each parent account chooses its own default.

**Practice attempt**:
A parent-confirmed correct or incorrect result for one word. Adding a word,
listening to dictation, and reading a photo are not practice attempts.

**Challenge**:
A parent account's ordered set of words to write during dictation and then check
manually or with photo-reading suggestions. Only confirmed answers affect progress
and statistics; the answers may be numbered or separated by punctuation or lines.
_Avoid_: Round, practice round, photo round, test score for the child

**Challenge timing**:
Private per-challenge navigation and stop events, with elapsed time at a word,
selected interval, and automatic/manual progression. Automatic intervals begin
after dictation finishes. These are app-interaction times, not measurements of
physical writing or third-party analytics.

**Challenge check**:
A separate parent evaluation after writing finishes, started immediately or later
from history. Manual and photo-assisted checks record confirmed per-word results,
optional written spellings, method, and evaluation time. Photo-assisted checks
also retain metadata-stripped image evidence, upload and recognition times, and
raw recognized spellings. Recognition alone is not a confirmed practice attempt.

**Learning category**:
Default, +, or −: a word's current practice position, determined by confirmed
attempts rather than a grade for the child, starting in Default. Three consecutive
correct answers earn +; a mistake on + returns to Default, two consecutive mistakes
lead to −, and a − word stays there until it earns +.

**Mixed practice**:
A challenge that prioritizes Default and − words, with occasional + words for
reinforcement, targeting 50% Default, 40% −, and 10% +. Missing groups are filled
from available words without repeats; an explicit category filter restricts the
challenge to that category.

Within each category, words never used or checked come first, followed by those
least recently used or checked. Selection uses the later of the last confirmed
check and the most recent saved challenge start, including unchecked challenges.
Equal-priority words and the final dictation order are randomized. This rotates
through the available words without changing the category mix or word progress.
