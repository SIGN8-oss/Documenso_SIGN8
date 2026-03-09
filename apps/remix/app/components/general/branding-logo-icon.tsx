import type { ImgHTMLAttributes } from 'react';

import LogoIconImage from '@documenso/assets/sign8_logo_icon.png';

export type LogoProps = ImgHTMLAttributes<HTMLImageElement>;

export const BrandingLogoIcon = ({ className, ...props }: LogoProps) => {
  return <img src={LogoIconImage} alt="Sign8" className={className} {...props} />;
};
