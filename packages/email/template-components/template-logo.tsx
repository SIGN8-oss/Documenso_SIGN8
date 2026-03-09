import { Column, Img, Row } from '../components';

export type TemplateLogoProps = {
  assetBaseUrl: string;
};

export const TemplateLogo = ({ assetBaseUrl }: TemplateLogoProps) => {
  const logoUrl = new URL('/static/sign8_logo.png', assetBaseUrl).toString();

  return (
    <Row className="mb-4">
      <Column style={{ width: '44px', verticalAlign: 'middle' }}>
        <Img src={logoUrl} alt="Sign8" width="40" height="40" />
      </Column>
      <Column style={{ verticalAlign: 'middle' }}>
        <span
          style={{
            fontFamily: "'Roboto', Arial, sans-serif",
            fontWeight: 700,
            fontSize: '22px',
            color: '#1e6568',
            letterSpacing: '1px',
          }}
        >
          SIGN8
        </span>
      </Column>
    </Row>
  );
};

export default TemplateLogo;
