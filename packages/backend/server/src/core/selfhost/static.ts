import { join } from 'node:path';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Application } from 'express';
import type { Response } from 'express';
import { static as serveStatic } from 'express';
import isMobile from 'is-mobile';

import { Config } from '../../base';
import { SetupMiddleware } from './setup';

@Injectable()
export class StaticFilesResolver implements OnModuleInit {
  private readonly logger = new Logger(StaticFilesResolver.name);

  constructor(
    private readonly config: Config,
    private readonly adapterHost: HttpAdapterHost,
    private readonly check: SetupMiddleware
  ) {}

  private sendStaticHtml(
    res: Response,
    filePath: string,
    fallback: { title: string; description: string }
  ) {
    res.sendFile(filePath, err => {
      if (!err) {
        return;
      }

      const error = err as NodeJS.ErrnoException;
      if (error.code && error.code !== 'ENOENT') {
        this.logger.error(
          `Failed to serve static file ${filePath}: ${error.message}`
        );
        res.status(500).end();
        return;
      }

      this.logger.warn(
        `Static file ${filePath} not found. Using built-in fallback page.`
      );

      res
        .status(200)
        .type('html')
        .send(this.buildFallbackHtml(fallback.title, fallback.description));
    });
  }

  private buildFallbackHtml(title: string, description: string) {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, shrink-to-fit=no"
    />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI',
          sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f7f8fb;
        color: #202124;
        padding: 32px;
      }

      @media (prefers-color-scheme: dark) {
        body {
          background: #121212;
          color: #e8eaed;
        }
      }

      main {
        max-width: 640px;
        text-align: center;
      }

      h1 {
        font-size: 2rem;
        margin-bottom: 0.75rem;
      }

      p {
        font-size: 1rem;
        line-height: 1.5;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${description}</p>
    </main>
  </body>
</html>`;
  }

  onModuleInit() {
    // in command line mode
    if (!this.adapterHost.httpAdapter) {
      return;
    }

    const app = this.adapterHost.httpAdapter.getInstance<Application>();
    // for example, '/affine' in host [//host.com/affine]
    const basePath = this.config.server.path;
    const staticPath = join(env.projectRoot, 'static');

    // web => {
    //   affine: 'static/index.html',
    //   selfhost: 'static/selfhost.html'
    // }
    // admin => {
    //   affine: 'static/admin/index.html',
    //   selfhost: 'static/admin/selfhost.html'
    // }
    // mobile => {
    //   affine: 'static/mobile/index.html',
    //   selfhost: 'static/mobile/selfhost.html'
    // }
    // NOTE(@forehalo):
    //   the order following routes should be respected,
    //   otherwise the app won't work properly.

    // START REGION: /admin
    // do not allow '/index.html' url, redirect to '/'
    app.get(basePath + '/admin/index.html', (_req, res) => {
      return res.redirect(basePath + '/admin');
    });

    // serve all static files
    app.use(
      basePath,
      serveStatic(join(staticPath, 'admin'), {
        redirect: false,
        index: false,
        fallthrough: true,
      })
    );

    // fallback all unknown routes
    app.get(
      [basePath + '/admin', basePath + '/admin/*path'],
      this.check.use,
      (_req, res) => {
        this.sendStaticHtml(
          res,
          join(
            staticPath,
            'admin',
            env.selfhosted ? 'selfhost.html' : 'index.html'
          ),
          {
            title: 'AFFiNE Admin',
            description:
              'AFFiNE admin static assets are missing. Please build the web assets and mount the `static/admin` directory.',
          }
        );
      }
    );
    // END REGION

    // START REGION: /mobile
    // serve all static files
    app.use(
      basePath,
      serveStatic(join(staticPath, 'mobile'), {
        redirect: false,
        index: false,
        fallthrough: true,
      })
    );
    // END REGION

    // START REGION: /
    // do not allow '/index.html' url, redirect to '/'
    app.get(basePath + '/index.html', (_req, res) => {
      return res.redirect(basePath);
    });

    // serve all static files
    app.use(
      basePath,
      serveStatic(staticPath, {
        redirect: false,
        index: false,
        fallthrough: true,
        immutable: true,
        dotfiles: 'ignore',
      })
    );

    // fallback all unknown routes
    app.get([basePath, basePath + '/*path'], this.check.use, (req, res) => {
      const mobile =
        env.namespaces.canary &&
        isMobile({
          ua: req.headers['user-agent'] ?? undefined,
        });

      const scope = mobile ? 'AFFiNE Mobile' : 'AFFiNE';
      const assetPath = join(
        staticPath,
        mobile ? 'mobile' : '',
        env.selfhosted ? 'selfhost.html' : 'index.html'
      );

      this.sendStaticHtml(res, assetPath, {
        title: scope,
        description:
          'AFFiNE static assets are missing. Please build the web bundle and make the `static` directory available to the server.',
      });
    });
    // END REGION
  }
}
