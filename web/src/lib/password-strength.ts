// Password strength with zxcvbn-ts, loaded on first use so its dictionaries
// stay out of the main bundle. Advisory only: the server's CheckPassword is
// the one gate (length and the breached list).

import { useEffect, useState } from "react";

export type Strength = { score: 0 | 1 | 2 | 3 | 4; warning: string | null };

type Checker = (pw: string, inputs: string[]) => Strength;
let checker: Promise<Checker> | null = null;

function load(): Promise<Checker> {
  checker ??= Promise.all([import("@zxcvbn-ts/core"), import("@zxcvbn-ts/language-common"), import("@zxcvbn-ts/language-en")]).then(
    ([core, common, en]) => {
      const z = new core.ZxcvbnFactory({
        translations: en.translations,
        graphs: common.adjacencyGraphs,
        dictionary: { ...common.dictionary, ...en.dictionary },
      });
      return (pw, inputs) => {
        const r = z.check(pw, inputs);
        return { score: r.score as Strength["score"], warning: r.feedback.warning || null };
      };
    },
  );
  return checker;
}

/** A rough local estimate used until the checker loads. */
function quick(pw: string): Strength {
  if (!pw) return { score: 0, warning: null };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  let s = pw.length >= 16 ? 3 : pw.length >= 12 ? 2 : 1;
  if (kinds >= 3 && pw.length >= 12) s += 1;
  if (new Set(pw).size < 5) s = 1;
  return { score: Math.min(4, s) as Strength["score"], warning: null };
}

export function usePasswordStrength(pw: string, userInputs: string[] = []): Strength {
  const [res, setRes] = useState<Strength>(() => quick(pw));
  const key = userInputs.join("\u0000");
  useEffect(() => {
    let live = true;
    if (!pw) {
      setRes({ score: 0, warning: null });
      return;
    }
    setRes((r) => (r.score ? r : quick(pw)));
    const t = setTimeout(() => {
      void load()
        .then((check) => live && setRes(check(pw, key ? key.split("\u0000") : [])))
        .catch(() => live && setRes(quick(pw)));
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pw, key]);
  return res;
}
