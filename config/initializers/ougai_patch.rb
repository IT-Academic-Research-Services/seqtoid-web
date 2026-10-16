require 'ougai/formatters/base'

module Ougai
  module Formatters
    class Base
      alias original_format_datetime format_datetime

      def format_datetime(time)
        # Rails/TimeZone compliant using application zone
        time = Time.zone.at(time) if time.is_a?(Float)

        original_format_datetime(time)
      end
    end
  end
end
