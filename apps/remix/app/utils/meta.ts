import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';

export const appMetaTags = (title?: string) => {
  const description =
    'Sign8 – Your secure digital signing platform for electronic signatures, document management, and streamlined workflows.';

  return [
    {
      title: title ? `${title} | SIGN8 - SIPO` : 'SIGN8 - SIPO',
    },
    {
      name: 'description',
      content: description,
    },
    {
      name: 'keywords',
      content:
        'Sign8, electronic signature, digital signing, document signing, secure signing, e-signature',
    },
    {
      name: 'author',
      content: 'SIGN8 GmbH',
    },
    {
      name: 'robots',
      content: 'index, follow',
    },
    {
      property: 'og:title',
      content: 'Sign8 - Secure Digital Signing',
    },
    {
      property: 'og:description',
      content: description,
    },
    {
      property: 'og:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg`,
    },
    {
      property: 'og:type',
      content: 'website',
    },
  ];
};
