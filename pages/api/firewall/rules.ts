import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

interface IptablesRule {
  number: string;
  chain: string;
  target: string;
  prot: string;
  opt: string;
  source: string;
  destination: string;
  extra: string;
}

function parseIptablesLine(line: string): IptablesRule | null {
  // Matches: num target prot opt source destination
  // e.g. 1    ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:22
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 6) return null;

  const [number, target, prot, opt, source, destination, ...rest] = parts;
  const extra = rest.join(' ');

  return {
    number,
    chain: '', // filled by caller
    target: target.toUpperCase(),
    prot,
    opt,
    source,
    destination,
    extra,
  };
}

function parseIptables(raw: string, chain: string): IptablesRule[] {
  const lines = raw.split('\n');
  const rules: IptablesRule[] = [];

  for (const line of lines) {
    const rule = parseIptablesLine(line);
    if (rule) {
      rule.chain = chain;
      rules.push(rule);
    }
  }

  return rules;
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    if (req.method === 'GET') {
      // Read rules from all main chains
      const chains = ['INPUT', 'FORWARD', 'OUTPUT'];
      const results: Record<string, IptablesRule[]> = {};
      let allRules: IptablesRule[] = [];

      for (const chain of chains) {
        const result = await executeRaw(`sudo iptables -L ${chain} --line-numbers -n 2>/dev/null`, 8000);
        const rules = parseIptables(result.stdout || '', chain);
        results[chain] = rules;
        allRules = allRules.concat(rules);
      }

      // Get default policies
      const defaultPolicies: Record<string, string> = {};
      for (const chain of chains) {
        const policyResult = await executeRaw(`sudo iptables -L ${chain} -n 2>/dev/null | head -2 | tail -1`, 5000);
        const match = (policyResult.stdout || '').match(/Chain\s+\w+\s+\(policy\s+(\w+)\)/);
        if (match) {
          defaultPolicies[chain] = match[1].toUpperCase();
        } else {
          defaultPolicies[chain] = 'ACCEPT';
        }
      }

      // Determine if firewall is "active" (has any non-default rules)
      const hasRules = allRules.length > 0;

      return res.status(200).json({
        success: true,
        data: {
          status: hasRules ? 'active' : 'inactive',
          defaultPolicies,
          chains,
          rules: allRules,
          rulesByChain: results,
        },
      });
    }

    if (req.method === 'POST') {
      const { chain, action, source, destination, protocol, port, dport, sport } = req.body;

      if (!chain || !action) {
        return res.status(400).json({ success: false, error: 'Chain e ação são obrigatórios' });
      }

      const chainUpper = chain.toUpperCase();
      const validChains = ['INPUT', 'OUTPUT', 'FORWARD'];
      if (!validChains.includes(chainUpper)) {
        return res.status(400).json({ success: false, error: 'Chain inválida. Use: INPUT, OUTPUT ou FORWARD' });
      }

      const actionLower = action.toLowerCase();
      const validActions = ['accept', 'drop', 'reject'];
      if (!validActions.includes(actionLower)) {
        return res.status(400).json({ success: false, error: 'Ação inválida. Use: ACCEPT, DROP ou REJECT' });
      }

      // Build iptables command
      const cmdParts = ['sudo', 'iptables', '-A', chainUpper];

      if (source && source !== 'any' && source !== '0.0.0.0/0') {
        cmdParts.push('-s', source);
      }

      if (destination && destination !== 'any' && destination !== '0.0.0.0/0') {
        cmdParts.push('-d', destination);
      }

      if (protocol && protocol !== 'any' && protocol !== 'all') {
        cmdParts.push('-p', protocol.toLowerCase());
      }

      if (port) {
        cmdParts.push('--dport', String(port));
      } else if (dport) {
        cmdParts.push('--dport', String(dport));
      }

      if (sport) {
        cmdParts.push('--sport', String(sport));
      }

      cmdParts.push('-j', actionUpper(actionLower));

      const cmd = cmdParts.join(' ');
      const result = await executeRaw(cmd, 10000);

      if (result.code !== 0) {
        return res.status(400).json({
          success: false,
          error: result.stderr || 'Erro ao adicionar regra iptables',
        });
      }

      return res.status(200).json({ success: true, data: { added: true, command: cmd } });
    }

    if (req.method === 'DELETE') {
      const { chain, ruleNumber } = req.body;

      if (!chain || !ruleNumber) {
        return res.status(400).json({ success: false, error: 'Chain e número da regra são obrigatórios' });
      }

      const chainUpper = chain.toUpperCase();
      const result = await executeRaw(`sudo iptables -D ${chainUpper} ${ruleNumber}`, 8000);

      if (result.code !== 0) {
        return res.status(400).json({
          success: false,
          error: result.stderr || 'Erro ao remover regra iptables',
        });
      }

      return res.status(200).json({ success: true, data: { deleted: true } });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

function actionUpper(action: string): string {
  switch (action) {
    case 'accept': return 'ACCEPT';
    case 'drop': return 'DROP';
    case 'reject': return 'REJECT';
    default: return action.toUpperCase();
  }
}
