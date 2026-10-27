# Soundfont

`generaluser-gs-tabello.sf2` is the soundfont TaBello plays scores with. It is made from
[GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) v2.0.3 by S. Christian Collins
(<http://www.schristiancollins.com>), under the license in [LICENSE.txt](LICENSE.txt), which allows its
use and modification in software.

It keeps the instruments TaBello plays (Steel Guitar, Nylon Guitar for the ukulele, Finger Bass and the
metronome click of the drum kit) and gives them the same loudness; the samples are unchanged. To
rebuild it from the full GeneralUser GS:

```sh
python3 scripts/build-soundfont.py GeneralUser-GS.sf2 src/renderer/public/soundfont/generaluser-gs-tabello.sf2
```
