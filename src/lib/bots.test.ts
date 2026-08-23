import { describe, expect, it } from 'vitest';
import { ehAcessoAutomatico } from './bots';

/** User-agents reais, copiados de logs. */
const PREVIEW_AUTOMATICO = [
  // o caso que motiva o filtro inteiro: o WhatsApp busca o link ao enviar
  'WhatsApp/2.2429.7 N',
  'WhatsApp/2.23.20.0 A',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'facebookexternalhit/1.1',
  'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
  'TelegramBot (like TwitterBot)',
  'Twitterbot/1.0',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1)',
  'SkypeUriPreview Preview/0.5',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'curl/8.7.1',
  'Wget/1.21.3',
  'python-requests/2.31.0',
  'Go-http-client/2.0',
  'axios/1.6.7',
  'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
];

/** Navegadores de verdade — estes CONTAM como clique. */
const GENTE_DE_VERDADE = [
  // Android, que é o que mais aparece nesta operação
  'Mozilla/5.0 (Linux; Android 13; SM-A processor) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  // navegador interno do WhatsApp no Android — é a PESSOA tocando no link
  'Mozilla/5.0 (Linux; Android 11; moto g(30)) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  // iPhone
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  // desktop
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

describe('ehAcessoAutomatico', () => {
  it.each(PREVIEW_AUTOMATICO)('bot: %s', (userAgent) => {
    expect(ehAcessoAutomatico({ userAgent })).toBe(true);
  });

  it.each(GENTE_DE_VERDADE)('pessoa: %s', (userAgent) => {
    expect(ehAcessoAutomatico({ userAgent })).toBe(false);
  });

  it('HEAD nunca é gente, mesmo com user-agent de navegador', () => {
    const ua = GENTE_DE_VERDADE[0];
    expect(ehAcessoAutomatico({ userAgent: ua, metodo: 'HEAD' })).toBe(true);
    expect(ehAcessoAutomatico({ userAgent: ua, metodo: 'head' })).toBe(true);
    expect(ehAcessoAutomatico({ userAgent: ua, metodo: 'GET' })).toBe(false);
  });

  it('user-agent ausente ou vazio é máquina', () => {
    expect(ehAcessoAutomatico({ userAgent: null })).toBe(true);
    expect(ehAcessoAutomatico({ userAgent: undefined })).toBe(true);
    expect(ehAcessoAutomatico({ userAgent: '' })).toBe(true);
    expect(ehAcessoAutomatico({ userAgent: '   ' })).toBe(true);
  });

  it('o envio de uma mensagem não pode contar como clique do eleitor', () => {
    // Cenário completo: atendente envia → WhatsApp pré-carrega → pessoa abre.
    // Só o terceiro acesso pode entrar na métrica.
    const preCarregamento = { userAgent: 'WhatsApp/2.2429.7 N' };
    const previewMeta = { userAgent: 'facebookexternalhit/1.1' };
    const pessoa = { userAgent: GENTE_DE_VERDADE[0] };

    const acessos = [preCarregamento, previewMeta, pessoa];
    const cliquesReais = acessos.filter((a) => !ehAcessoAutomatico(a));

    expect(cliquesReais).toHaveLength(1);
    expect(cliquesReais[0]).toBe(pessoa);
  });
});
