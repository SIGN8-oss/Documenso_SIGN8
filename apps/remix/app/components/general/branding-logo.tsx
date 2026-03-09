import type { ImgHTMLAttributes } from 'react';

import LogoImage from '@documenso/assets/sign8_logo.png';

export type LogoProps = ImgHTMLAttributes<HTMLImageElement>;

export const BrandingLogo = ({ className, ...props }: LogoProps) => {
  return <img src={LogoImage} alt="Sign8" className={className} {...props} />;
};
