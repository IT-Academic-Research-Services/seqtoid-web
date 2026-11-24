import React from "react";
import { Footer } from "~/components/common/Footer";
import { LandingHeader as Header } from "~/components/common/LandingHeader";
import { Content } from "~/components/views/LandingPage/components/Content";
import { Hero } from "~/components/views/LandingPage/components/Hero";

interface LandingPageProps {
  emergencyBannerMessage?: string;
}

export const LandingPage = ({
  emergencyBannerMessage,
}: LandingPageProps) => {
  return (
    <div>
      <Header emergencyBannerMessage={emergencyBannerMessage} />
      <Hero />
      <Content />
      <Footer />
    </div>
  );
};
