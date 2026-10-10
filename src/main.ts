import '@fontsource-variable/inter/wght.css';
import './styles/jetons.css';
import './styles/base.css';
import './styles/coque.css';
import './styles/composants.css';
import './styles/intro.css';
import './styles/accueil.css';
import './styles/veille.css';
import './styles/fec.css';
import './styles/circularisations.css';
import './styles/tva.css';
import { monterCoque } from './app/coque.ts';
import { lancerIntro } from './app/intro/intro.ts';
import { MODULES } from './modules/index.ts';

const racine = document.getElementById('app');
if (!racine) throw new Error('Élément #app introuvable.');

monterCoque(racine, { modules: MODULES, version: __APP_VERSION__, canal: __CANAL__ });
lancerIntro();
