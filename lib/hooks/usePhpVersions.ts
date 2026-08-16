import { useState, useEffect } from 'react';

interface PhpVersionResponse {
  version: string;
  fpmInstalled: boolean;
  fpmActive: boolean;
}

export interface PhpVersionOption {
  value: string;
  label: string;
  active: boolean;
}

/**
 * Versões de PHP realmente presentes no servidor.
 *
 * A lista era fixa no código (8.0 a 8.3) e o Ubuntu 25.10 entrega o 8.4 — então
 * todo site PHP criado numa instalação limpa apontava para um socket que não
 * existe e nascia em 502, com o painel reportando sucesso porque `nginx -t` não
 * valida socket.
 */
export function usePhpVersions() {
  const [versions, setVersions] = useState<PhpVersionOption[]>([]);
  const [preferred, setPreferred] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/php');
        const json = await res.json();
        if (cancelled) return;

        if (json.success) {
          const list = json.data.versions as PhpVersionResponse[];
          setVersions(
            list
              .filter(version => version.fpmInstalled)
              .map(version => ({
                value: version.version,
                label: version.fpmActive ? `PHP ${version.version}` : `PHP ${version.version} (FPM parado)`,
                active: version.fpmActive,
              })),
          );
          setPreferred(json.data.preferred);
        }
      } catch {
        // Sem resposta da API a lista fica vazia, e a UI diz para instalar.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return { versions, preferred, loading, hasAny: versions.length > 0 };
}
