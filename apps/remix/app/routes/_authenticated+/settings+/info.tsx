import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ExternalLinkIcon } from 'lucide-react';

import { SettingsHeader } from '~/components/general/settings-header';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Info');
}

export default function SettingsInfo() {
  const { _ } = useLingui();

  return (
    <div>
      <SettingsHeader
        title={_(msg`Info`)}
        subtitle={_(msg`About SIPO and open-source license information.`)}
      />

      <div className="mt-6 space-y-6">
        <section>
          <h3 className="text-lg font-medium">
            <Trans>About SIPO</Trans>
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            <Trans>
              SIPO is a document signing platform built on open-source technology. It provides
              qualified electronic signatures (QES), advanced electronic signatures (AES), and
              simple electronic signatures (SES) for secure and legally binding document workflows.
            </Trans>
          </p>
        </section>

        <hr className="border-border/50" />

        <section>
          <h3 className="text-lg font-medium">
            <Trans>Open Source License</Trans>
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            <Trans>
              SIPO is a fork of Documenso, an open-source document signing platform licensed under
              the GNU Affero General Public License v3.0 (AGPL-3.0). In accordance with the terms of
              the AGPL-3.0, the source code of SIPO is made available to all users.
            </Trans>
          </p>
        </section>

        <hr className="border-border/50" />

        <section>
          <h3 className="text-lg font-medium">
            <Trans>Documenso Attribution</Trans>
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            <Trans>
              This software is based on Documenso, created and maintained by the Documenso
              community.
            </Trans>
          </p>
          <a
            href="https://github.com/documenso/documenso"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            github.com/documenso/documenso
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
        </section>

        <hr className="border-border/50" />

        <section>
          <h3 className="text-lg font-medium">
            <Trans>SIPO Source Code</Trans>
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            <Trans>
              The complete source code of SIPO is available on GitHub under the AGPL-3.0 license.
            </Trans>
          </p>
          <a
            href="https://github.com/your-org/sipo"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            github.com/your-org/sipo
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
        </section>

        <hr className="border-border/50" />

        <section>
          <h3 className="text-lg font-medium">
            <Trans>Full License Text</Trans>
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            <Trans>
              You can read the full text of the GNU Affero General Public License v3.0 at the
              following link.
            </Trans>
          </p>
          <a
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            GNU AGPL-3.0
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
        </section>
      </div>
    </div>
  );
}
