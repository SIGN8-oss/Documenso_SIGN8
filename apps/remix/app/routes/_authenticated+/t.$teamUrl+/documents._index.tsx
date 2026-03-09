import { useEffect, useMemo, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { EnvelopeType } from '@prisma/client';
import { FolderType, OrganisationType } from '@prisma/client';
import { useParams, useSearchParams } from 'react-router';
import { Link } from 'react-router';
import { z } from 'zod';

import { useSessionStorage } from '@documenso/lib/client-only/hooks/use-session-storage';
import { useCurrentOrganisation } from '@documenso/lib/client-only/providers/organisation';
import { formatAvatarUrl } from '@documenso/lib/utils/avatars';
import { parseToIntegerArray } from '@documenso/lib/utils/params';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import { ExtendedDocumentStatus } from '@documenso/prisma/types/extended-document-status';
import { trpc } from '@documenso/trpc/react';
import type { TFindDocumentsInternalResponse } from '@documenso/trpc/server/document-router/find-documents-internal.types';
import { ZFindDocumentsInternalRequestSchema } from '@documenso/trpc/server/document-router/find-documents-internal.types';
import { cn } from '@documenso/ui/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@documenso/ui/primitives/avatar';
import type { RowSelectionState } from '@documenso/ui/primitives/data-table';

import { DocumentMoveToFolderDialog } from '~/components/dialogs/document-move-to-folder-dialog';
import { EnvelopesBulkDeleteDialog } from '~/components/dialogs/envelopes-bulk-delete-dialog';
import { EnvelopesBulkMoveDialog } from '~/components/dialogs/envelopes-bulk-move-dialog';
import { DocumentSearch } from '~/components/general/document/document-search';
import { DocumentStatus } from '~/components/general/document/document-status';
import { EnvelopeDropZoneWrapper } from '~/components/general/envelope/envelope-drop-zone-wrapper';
import { FolderGrid } from '~/components/general/folder/folder-grid';
import { PeriodSelector } from '~/components/general/period-selector';
import { DocumentsTable } from '~/components/tables/documents-table';
import { DocumentsTableEmptyState } from '~/components/tables/documents-table-empty-state';
import { DocumentsTableSenderFilter } from '~/components/tables/documents-table-sender-filter';
import { EnvelopesTableBulkActionBar } from '~/components/tables/envelopes-table-bulk-action-bar';
import { useCurrentTeam } from '~/providers/team';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Documents');
}

const ZSearchParamsSchema = ZFindDocumentsInternalRequestSchema.pick({
  status: true,
  period: true,
  page: true,
  perPage: true,
  query: true,
}).extend({
  senderIds: z.string().transform(parseToIntegerArray).optional().catch([]),
});

export default function DocumentsPage() {
  const organisation = useCurrentOrganisation();
  const team = useCurrentTeam();

  const { folderId } = useParams();
  const [searchParams] = useSearchParams();

  const [isMovingDocument, setIsMovingDocument] = useState(false);
  const [documentToMove, setDocumentToMove] = useState<number | null>(null);

  const [rowSelection, setRowSelection] = useSessionStorage<RowSelectionState>(
    'documents-bulk-selection',
    {},
  );
  const [isBulkMoveDialogOpen, setIsBulkMoveDialogOpen] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  const selectedEnvelopeIds = useMemo(() => {
    return Object.keys(rowSelection).filter((id) => rowSelection[id]);
  }, [rowSelection]);

  const [stats, setStats] = useState<TFindDocumentsInternalResponse['stats']>({
    [ExtendedDocumentStatus.DRAFT]: 0,
    [ExtendedDocumentStatus.PENDING]: 0,
    [ExtendedDocumentStatus.COMPLETED]: 0,
    [ExtendedDocumentStatus.REJECTED]: 0,
    [ExtendedDocumentStatus.INBOX]: 0,
    [ExtendedDocumentStatus.ALL]: 0,
  });

  const findDocumentSearchParams = useMemo(
    () => ZSearchParamsSchema.safeParse(Object.fromEntries(searchParams.entries())).data || {},
    [searchParams],
  );

  const { data, isLoading, isLoadingError } = trpc.document.findDocumentsInternal.useQuery({
    ...findDocumentSearchParams,
    folderId,
  });

  const getTabHref = (value: keyof typeof ExtendedDocumentStatus) => {
    const params = new URLSearchParams(searchParams);

    params.set('status', value);

    if (value === ExtendedDocumentStatus.ALL) {
      params.delete('status');
    }

    if (value === ExtendedDocumentStatus.INBOX && organisation.type === OrganisationType.PERSONAL) {
      params.delete('status');
    }

    if (params.has('page')) {
      params.delete('page');
    }

    let path = formatDocumentsPath(team.url);

    if (folderId) {
      path += `/f/${folderId}`;
    }

    if (params.toString()) {
      path += `?${params.toString()}`;
    }

    return path;
  };

  useEffect(() => {
    if (data?.stats) {
      setStats(data.stats);
    }
  }, [data?.stats]);

  return (
    <EnvelopeDropZoneWrapper type={EnvelopeType.DOCUMENT}>
      <div className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
        <FolderGrid type={FolderType.DOCUMENT} parentId={folderId ?? null} />

        <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-8">
          <div className="flex flex-row items-center">
            <Avatar className="mr-3 h-12 w-12 border-2 border-solid border-white dark:border-border">
              {team.avatarImageId && <AvatarImage src={formatAvatarUrl(team.avatarImageId)} />}
              <AvatarFallback className="text-xs text-muted-foreground">
                {team.name.slice(0, 1)}
              </AvatarFallback>
            </Avatar>

            <h2 className="text-4xl font-semibold">
              <Trans>Documents</Trans>
            </h2>
          </div>

          <div className="-m-1 flex flex-wrap gap-x-4 gap-y-6 overflow-hidden p-1">
            <nav aria-label="Document status" className="overflow-x-auto">
              <div
                role="tablist"
                aria-orientation="horizontal"
                className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground"
              >
                {[
                  ExtendedDocumentStatus.INBOX,
                  ExtendedDocumentStatus.PENDING,
                  ExtendedDocumentStatus.COMPLETED,
                  ExtendedDocumentStatus.DRAFT,
                  ExtendedDocumentStatus.ALL,
                ]
                  .filter((value) => {
                    if (organisation.type === OrganisationType.PERSONAL) {
                      return value !== ExtendedDocumentStatus.INBOX;
                    }

                    return true;
                  })
                  .map((value) => {
                    const isActive = (findDocumentSearchParams.status || 'ALL') === value;

                    return (
                      <Link
                        key={value}
                        role="tab"
                        aria-selected={isActive}
                        aria-current={isActive ? 'page' : undefined}
                        to={getTabHref(value)}
                        preventScrollReset
                        className={cn(
                          'inline-flex min-w-[60px] items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          isActive
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-foreground/70',
                        )}
                      >
                        <DocumentStatus status={value} />

                        {value !== ExtendedDocumentStatus.ALL && (
                          <span className="ml-1 inline-block opacity-50">{stats[value]}</span>
                        )}
                      </Link>
                    );
                  })}
              </div>
            </nav>

            {team && <DocumentsTableSenderFilter teamId={team.id} />}

            <div className="flex w-48 flex-wrap items-center justify-between gap-x-2 gap-y-4">
              <PeriodSelector />
            </div>
            <div className="flex w-48 flex-wrap items-center justify-between gap-x-2 gap-y-4">
              <DocumentSearch initialValue={findDocumentSearchParams.query} />
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div>
            {data && data.count === 0 ? (
              <DocumentsTableEmptyState
                status={findDocumentSearchParams.status || ExtendedDocumentStatus.ALL}
              />
            ) : (
              <DocumentsTable
                data={data}
                isLoading={isLoading}
                isLoadingError={isLoadingError}
                onMoveDocument={(documentId) => {
                  setDocumentToMove(documentId);
                  setIsMovingDocument(true);
                }}
                enableSelection
                rowSelection={rowSelection}
                onRowSelectionChange={setRowSelection}
              />
            )}
          </div>
        </div>

        {documentToMove && (
          <DocumentMoveToFolderDialog
            documentId={documentToMove}
            open={isMovingDocument}
            currentFolderId={folderId}
            onOpenChange={(open) => {
              setIsMovingDocument(open);

              if (!open) {
                setDocumentToMove(null);
              }
            }}
          />
        )}

        <EnvelopesTableBulkActionBar
          selectedCount={selectedEnvelopeIds.length}
          onMoveClick={() => setIsBulkMoveDialogOpen(true)}
          onDeleteClick={() => setIsBulkDeleteDialogOpen(true)}
          onClearSelection={() => setRowSelection({})}
        />

        <EnvelopesBulkMoveDialog
          envelopeIds={selectedEnvelopeIds}
          envelopeType={EnvelopeType.DOCUMENT}
          open={isBulkMoveDialogOpen}
          currentFolderId={folderId}
          onOpenChange={setIsBulkMoveDialogOpen}
          onSuccess={() => setRowSelection({})}
        />

        <EnvelopesBulkDeleteDialog
          envelopeIds={selectedEnvelopeIds}
          envelopeType={EnvelopeType.DOCUMENT}
          open={isBulkDeleteDialogOpen}
          onOpenChange={setIsBulkDeleteDialogOpen}
          onSuccess={() => setRowSelection({})}
        />
      </div>
    </EnvelopeDropZoneWrapper>
  );
}
