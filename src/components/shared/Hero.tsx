"use client";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState, useCallback } from "react";
import { useSocket } from "@/contexts/SocketContext";
import SponsoredBy from "@/components/shared/SponsoredBy";

const Hero = () => {
  const router = useRouter();
  const { signInWithGoogle, signOut, user, isLoading } = useAuth();
  const [isExiting, setIsExiting] = useState(false);
  const { socket } = useSocket();
  const handleAuthClick = async () => {
    if (!user) {
      await signInWithGoogle();
      return;
    }
    setIsExiting(true);
    setTimeout(() => {
      socket?.emit("client:join");
      router.push("/dashboard");
    }, 1000);
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push("/");
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const handleKeyPress = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Enter" && user) {
        setIsExiting(true);
        setTimeout(() => {
          router.push("/dashboard");
        }, 1000); // Wait for animation to complete
      }
    },
    [user, router],
  );

  useEffect(() => {
    // Add event listener for keydown
    window.addEventListener("keydown", handleKeyPress);

    // Cleanup event listener on component unmount
    return () => {
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, [handleKeyPress]);

  return (
    <div
      className={`bg-[url(/Landingpage.svg)] bg-cover h-screen transform transition-transform duration-1000 overflow-x-hidden overflow-y-hidden ease-out ${
        isExiting ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="h-full z-1 orbitron text-white bg-[radial-gradient(50%_50%_at_50%_50%,rgba(0,0,0,0.17)_0%,rgba(0,0,0,0.57)_100%)]">
        {/* Logout button in top right */}
        {user && (
          <div className="absolute top-4 right-4 z-50">
            <button
              onClick={handleSignOut}
              disabled={isLoading}
              className="group flex items-center justify-start w-11 h-11 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full cursor-pointer relative overflow-hidden transition-all duration-200 shadow-lg hover:w-32 hover:rounded-lg hover:bg-white/20 active:translate-x-1 active:translate-y-1"
            >
              <div className="flex items-center justify-center w-full transition-all duration-300 group-hover:justify-start group-hover:px-3">
                <svg className="w-4 h-4" viewBox="0 0 512 512" fill="white">
                  <path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1-128 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l128 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z"></path>
                </svg>
              </div>
              <div className="absolute orbitron right-5 transform translate-x-full opacity-0 text-white text-lg font-semibold transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100">
                Logout
              </div>
            </button>
          </div>
        )}

        <div className="hud">
          <div className="absolute topHUD left-0 top-50 lg:top-2 h-[6rem] w-full flex items-center justify-center">
            <div className="text-white h-full w-full bg-[url(/TopBar.svg)] bg-no-repeat bg-center flex flex-col items-center justify-center space-y-6 tracking-wider">
              IEEE COMPUTER SOCIETY
            </div>
            <div className="text-white h-full w-full bg-[url(/TopBar.svg)] bg-no-repeat bg-center flex flex-col items-center justify-center space-y-6 absolute blur-md tracking-wider">
              IEEE COMPUTER SOCIETY
            </div>
            <div className="text-white h-full w-full bg-no-repeat bg-center flex flex-col items-center justify-center space-y-6 absolute blur-md tracking-wider">
              IEEE COMPUTER SOCIETY
            </div>
          </div>

          <div className="absolute leftHUD left-10 top-0 h-full w-[6rem] flex items-center justify-center">
            <div className="h-full w-full  lg:bg-[url(/LeftLine.svg)] bg-no-repeat bg-center flex flex-col items-center justify-center space-y-6"></div>
            <div className="h-full w-full  sm:hidden lg:bg-[url(/LeftLine.svg)] bg-no-repeat bg-center flex flex-col items-center justify-center space-y-6 absolute blur-md"></div>
          </div>
          <div className="absolute rightHUD right-10 top-0 h-full w-[6rem] flex items-center justify-center">
            <div className="h-full w-full  lg:bg-[url(/RightLine.svg)] bg-no-repeat bg-center flex flex-col items-center justify-center space-y-6"></div>
            <div className="h-full w-full  lg:bg-[url(/RightLine.svg)] bg-no-repeat bg-center flex flex-col items-center justify-center space-y-6 absolute blur-md"></div>
          </div>
          <div className="absolute bottomRight right-10 top-0 h-full w-[6rem] flex items-flex-end justify-center">
            <div className="h-full w-full    bg-no-repeat bg-center flex flex-col items-center justify-center space-y-6"></div>
            <div className="h-full w-full   bg-no-repeat bg-center flex flex-col items-center justify-center space-y-6 absolute blur-md"></div>
          </div>
        </div>

        <div className="containerContent flex flex-col items-center justify-center h-full ">
          <div className="relative flex items-center justify-center h-20 lg:h-28">
            <div className="z-1 absolute jusify-items items-center flex drop-shadow-[0_px_4px_#000]">
              <h1 className="text-4xl lg:text-8xl z-1 tracking-wide px-8 font-medium stickyMask text-shadow-heading">
                BATTLECODE
              </h1>
              <h1 className="text-5xl lg:text-8xl text-blur tracking-wide font-medium blur-sm absolute">
                BATTLECODE
              </h1>
            </div>
            <div className="flex absolute blur-3xl mix-blend-color-dodge">
              <h1 className="text-5xl lg:text-8xl z-1 tracking-wider font-medium stickyMask text-shadow-heading">
                BATTLECODE
              </h1>
              <h1 className="text-5xl lg:text-8xl text-blur tracking-wider font-medium blur-md absolute">
                BATTLECODE
              </h1>
            </div>
          </div>
          <SponsoredBy />

          <div className="relative "></div>

          <button
            onClick={handleAuthClick}
            disabled={isLoading}
            className="hidden lg:block relative gradient-border-button text-white uppercase tracking-wider hover:tracking-widest duration-[350ms] ease-out font-medium text-md mt-6"
          >
            {isLoading
              ? "LOADING..."
              : user
                ? "DASHBOARD"
                : "SIGN IN WITH GOOGLE"}
          </button>
        </div>

        <div className="w-[27rem] quote   flex relative bottom-50 lg:bottom-8 z-10 left-1/2 transform -translate-x-1/2 justify-center">
          <p className="z-1 text-center uppercase text-white tracking-[4px] absolute bottom-[5rem] text-[0.80rem] lg:text-[0.80rem] px-8 lg:px-0">
            This is more than just programming—it&apos;s precision under
            pressure. Enter the match with intent. Exit with impact.
          </p>
          <p className="text-center uppercase text-white tracking-[4px] absolute bottom-[5rem] blur-md text-[0.85rem]">
            This is more than just programming—it&apos;s precision under
            pressure. Enter the match with intent. Exit with impact.
          </p>
        </div>
        <div className="sm:hidden justify-center text-white flex relative bottom-42 lg:bottom-8 z-10 left-1/2 transform -translate-x-1/2 text-center text-white text-sm lg:text-md font-medium ">
          Please Open on Laptop
        </div>
      </div>
    </div>
  );
};

export default Hero;
