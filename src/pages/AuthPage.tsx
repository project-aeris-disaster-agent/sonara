import { NewAuthCard } from '../components/NewAuthCard';
import { DitheringShader } from '@/components/ui/dithering-shader';
import newFronteraLogo from '@assets/Asset 20small.png';

export function AuthPage() {
  const handleAuthSuccess = (userData: { email: string; name?: string }) => {
    console.log('Authentication successful:', userData);
    // Authentication redirect is handled by NewAuthCard component
  };

  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden">
      {/* Background Shader - Full screen fixed */}
      <DitheringShader 
        shape="wave"
        type="8x8"
        colorBack="#001122"
        colorFront="#ff0088"
        pxSize={3}
        speed={0.6}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 0,
        }}
      />
      
      {/* Floating Auth Form Container */}
      <div className="fixed inset-0 z-20 flex flex-col items-center justify-between p-4 sm:p-6 md:p-8 overflow-y-auto">
        {/* Header Logo - positioned above signup card */}
        <div className="mt-4 sm:mt-6 md:mt-8 z-50 flex flex-col items-center justify-center">
          <img 
            src="/sona-weblogo.svg" 
            alt="SONA Logo" 
            className="h-12 sm:h-16 md:h-20 w-auto mb-2 sm:mb-3"
          />
          <p className="text-white font-bold text-sm sm:text-base md:text-lg text-center">
            Automate your Online Persona with AI
          </p>
        </div>
        
        {/* Central Content Area - Signup Card */}
        <div className="flex-1 flex items-center justify-center w-full">
          <NewAuthCard onSuccess={handleAuthSuccess} />
        </div>
        
        {/* Web Image Logo - positioned below signup card */}
        <div className="mb-4 sm:mb-6 z-10 flex justify-center md:justify-start md:translate-x-[5%]">
          <img 
            src="/sona-webimage2.svg" 
            alt="SONA Web Image" 
            className="h-[187px] sm:h-[250px] md:h-[312px] w-auto max-w-full transition-all duration-300 ease-out hover:scale-110"
            style={{
              filter: 'drop-shadow(0 12px 40px rgba(0, 0, 0, 0.85)) drop-shadow(0 8px 24px rgba(0, 0, 0, 0.6)) drop-shadow(0 8px 24px rgba(255, 255, 255, 0.4)) drop-shadow(0 4px 16px rgba(255, 255, 255, 0.25))',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.filter = 'drop-shadow(0 16px 48px rgba(0, 0, 0, 0.95)) drop-shadow(0 12px 32px rgba(0, 0, 0, 0.7)) drop-shadow(0 12px 32px rgba(255, 255, 255, 0.5)) drop-shadow(0 6px 20px rgba(255, 255, 255, 0.35))';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'drop-shadow(0 12px 40px rgba(0, 0, 0, 0.85)) drop-shadow(0 8px 24px rgba(0, 0, 0, 0.6)) drop-shadow(0 8px 24px rgba(255, 255, 255, 0.4)) drop-shadow(0 4px 16px rgba(255, 255, 255, 0.25))';
            }}
          />
        </div>
        
        {/* Sandchain Logo - positioned at bottom */}
        <div className="mb-4 sm:mb-6 z-50 flex flex-col items-center justify-center">
          <p className="text-white/60 text-xs sm:text-sm mb-2">coming soon on</p>
          <img 
            src={newFronteraLogo} 
            alt="New Frontera Corp Logo" 
            className="h-8 sm:h-10 md:h-12 w-auto mb-3 sm:mb-4"
          />
          {/* Footer Copyright */}
          <p className="text-white/50 text-xs text-center">
            New Prontera Corp. 2025™ All Rights Reserved
          </p>
        </div>
      </div>
    </div>
  );
}

