import { Img } from '../components';

export type TemplateLogoProps = {
  assetBaseUrl: string;
};

export const TemplateLogo = ({ assetBaseUrl }: TemplateLogoProps) => {
  const logoUrl = new URL('/static/sign8_logo.png', assetBaseUrl).toString();

  return <Img src={logoUrl} alt="Sign8" width="40" height="40" className="mb-4" />;
};

export default TemplateLogo;
