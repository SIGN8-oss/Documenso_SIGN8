import React, { forwardRef } from 'react';

import { Trans } from '@lingui/react/macro';
import { SignatureLevel } from '@prisma/client';
import type { SelectProps } from '@radix-ui/react-select';
import { BadgeCheckIcon, InfoIcon, PenLineIcon, ShieldCheckIcon } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger } from '@documenso/ui/primitives/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@documenso/ui/primitives/tooltip';

export const SIGNATURE_LEVEL_ICONS: Record<SignatureLevel, React.ReactNode> = {
  [SignatureLevel.SES]: <PenLineIcon className="h-4 w-4 text-muted-foreground" />,
  [SignatureLevel.AES]: <ShieldCheckIcon className="h-4 w-4 text-blue-500" />,
  [SignatureLevel.QES]: <BadgeCheckIcon className="h-4 w-4 text-green-600" />,
};

export const SIGNATURE_LEVEL_LABELS: Record<SignatureLevel, string> = {
  [SignatureLevel.SES]: 'SES',
  [SignatureLevel.AES]: 'AES',
  [SignatureLevel.QES]: 'QES',
};

export type RecipientSignatureLevelSelectProps = SelectProps;

export const RecipientSignatureLevelSelect = forwardRef<
  HTMLButtonElement,
  RecipientSignatureLevelSelectProps
>(({ ...props }, ref) => (
  <Select {...props}>
    <SelectTrigger ref={ref} className="w-[70px] bg-background p-2">
      <div className="flex items-center gap-1">
        {/* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */}
        {SIGNATURE_LEVEL_ICONS[props.value as SignatureLevel]}
        <span className="text-xs font-medium">
          {/* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */}
          {SIGNATURE_LEVEL_LABELS[props.value as SignatureLevel]}
        </span>
      </div>
    </SelectTrigger>

    <SelectContent align="end">
      <SelectItem value={SignatureLevel.SES}>
        <div className="flex items-center">
          <div className="flex w-[180px] items-center">
            <span className="mr-2">{SIGNATURE_LEVEL_ICONS[SignatureLevel.SES]}</span>
            <Trans>SES (Simple)</Trans>
          </div>
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="z-9999 max-w-md p-4 text-foreground">
              <p>
                <Trans>
                  Simple Electronic Signature: Basic drawn or typed signature without cryptographic
                  verification. Suitable for internal documents and low-risk agreements.
                </Trans>
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </SelectItem>

      <SelectItem value={SignatureLevel.AES}>
        <div className="flex items-center">
          <div className="flex w-[180px] items-center">
            <span className="mr-2">{SIGNATURE_LEVEL_ICONS[SignatureLevel.AES]}</span>
            <Trans>AES (Advanced)</Trans>
          </div>
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="z-9999 max-w-md p-4 text-foreground">
              <p>
                <Trans>
                  Advanced Electronic Signature: Enhanced authentication with 2FA or passkey.
                  Uniquely linked to the signatory and suitable for business contracts.
                </Trans>
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </SelectItem>

      <SelectItem value={SignatureLevel.QES}>
        <div className="flex items-center">
          <div className="flex w-[180px] items-center">
            <span className="mr-2">{SIGNATURE_LEVEL_ICONS[SignatureLevel.QES]}</span>
            <Trans>QES (Qualified)</Trans>
          </div>
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="z-9999 max-w-md p-4 text-foreground">
              <p>
                <Trans>
                  Qualified Electronic Signature: Highest legal standard under eIDAS. The recipient
                  authenticates with Sign8 and signs with their own qualified certificate. Legally
                  equivalent to a handwritten signature.
                </Trans>
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </SelectItem>
    </SelectContent>
  </Select>
));

RecipientSignatureLevelSelect.displayName = 'RecipientSignatureLevelSelect';
