import type { CircuitGeometry } from "../types";
import { austinCircuit } from "./austin";
import { bakuCircuit } from "./baku";
import { barcelonaCircuit } from "./barcelona";
import { bahrainCircuit } from "./bahrain";
import { budapestCircuit } from "./budapest";
import { imolaCircuit } from "./imola";
import { jeddahCircuit } from "./jeddah";
import { las_vegasCircuit } from "./las_vegas";
import { lusailCircuit } from "./lusail";
import { madridCircuit } from "./madrid";
import { melbourneCircuit } from "./melbourne";
import { mexicoCircuit } from "./mexico";
import { miamiCircuit } from "./miami";
import { monacoCircuit } from "./monaco";
import { monzaCircuit } from "./monza";
import { montrealCircuit } from "./montreal";
import { sao_pauloCircuit } from "./sao_paulo";
import { shanghaiCircuit } from "./shanghai";
import { singaporeCircuit } from "./singapore";
import { silverstoneCircuit } from "./silverstone";
import { spaCircuit } from "./spa";
import { spielbergCircuit } from "./spielberg";
import { suzukaCircuit } from "./suzuka";
import { yas_marinaCircuit } from "./yas_marina";
import { zandvoortCircuit } from "./zandvoort";

export const BUNDLED_CIRCUITS: readonly CircuitGeometry[] = [
  austinCircuit, bakuCircuit, barcelonaCircuit, bahrainCircuit, budapestCircuit,
  imolaCircuit, jeddahCircuit, las_vegasCircuit, lusailCircuit, madridCircuit,
  melbourneCircuit, mexicoCircuit, miamiCircuit, monacoCircuit, monzaCircuit,
  montrealCircuit, sao_pauloCircuit, shanghaiCircuit, singaporeCircuit,
  silverstoneCircuit, spaCircuit, spielbergCircuit, suzukaCircuit,
  yas_marinaCircuit, zandvoortCircuit,
];
